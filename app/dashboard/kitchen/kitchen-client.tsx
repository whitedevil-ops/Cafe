'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createClient } from '@/utils/supabase/client'
import { useToast } from '@/components/ui/toast'
import { CancelOrderDialog } from '@/components/orders/cancel-order-dialog'
import { PrinterBanner, type PrinterHealth } from '@/components/kitchen/printer-banner'
import { useRealtimeRefresh } from '@/lib/use-realtime-refresh'
import { OfflineBanner } from '@/components/offline-banner'
import { printKot } from '@/components/kitchen/print-ticket'

type Order = {
  id: string
  short_code: string
  table_id: string | null
  type: string
  status: 'placed' | 'preparing' | 'ready'
  total: number
  payment_method: string | null
  payment_status: 'unpaid' | 'paid' | 'partial' | 'refunded'
  created_at: string
}
type Item = { id: string; order_id: string; name: string; qty: number; modifiers: { name: string }[] | null }

const NEXT: Record<Order['status'], { label: string; to: string }> = {
  placed: { label: 'Start', to: 'preparing' },
  preparing: { label: 'Ready', to: 'ready' },
  ready: { label: 'Done', to: 'completed' },
}

// Auto-print from this screen: the second path to paper.
//
// The bridge is the primary one and needs no tab open, but when it stops the
// café drops from fully automatic to one click per order — which is how a
// whole day went by with nothing printing and nobody noticing. With this on,
// an open Kitchen tab keeps printing on its own.
//
// Per-device, exactly like the desktop printer choice in desktop-print.ts:
// which screen is left open at the counter is a property of the machine, not
// of the café, so it does not belong in the database.
const AUTO_PRINT_KEY = 'kp:kitchen:auto-print'
// The orders this tab has already sent. sessionStorage, not localStorage: it
// belongs to this tab's run of the screen — a refresh mid-service must not
// re-print the board, but tomorrow's shift should start clean.
const AUTO_PRINTED_KEY = 'kp:kitchen:auto-printed'

function loadAutoPrinted(): Set<string> {
  try {
    const raw = sessionStorage.getItem(AUTO_PRINTED_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

/** Writes the ledger back, trimming it in place. */
function saveAutoPrinted(ids: Set<string>): void {
  // A tab left open for days would grow this without limit. An order old
  // enough to fall off the front is long gone from the board, so it can never
  // arrive "fresh" again and be printed twice.
  if (ids.size > 600) {
    for (const id of [...ids].slice(0, ids.size - 300)) ids.delete(id)
  }
  try {
    sessionStorage.setItem(AUTO_PRINTED_KEY, JSON.stringify([...ids]))
  } catch {
    // Storage unavailable — the in-memory set still blocks a double print for
    // as long as this tab stays open; only a refresh loses the record.
  }
}

// Whether this screen makes a noise. Per-device for the same reason as the
// auto-print switch above: the tablet on the pass wants the alarm, the
// manager's laptop open in the office does not — that is a property of the
// machine, not of the café.
const SOUND_KEY = 'kp:kitchen:sound'

function useDing(enabled: RefObject<boolean>) {
  const ctx = useRef<AudioContext | null>(null)
  // Whether the browser will actually let us make a noise. A page nobody has
  // touched yet is not allowed to play audio at all, so this starts false on
  // every fresh load — including one where the toggle was restored as on. It
  // is only ever set from the context's own state, never assumed: a cook
  // trusting a board that claims "sound on" while the browser silently
  // refuses is the one failure this screen cannot afford.
  const [ready, setReady] = useState(false)

  // Creating or resuming the context is only guaranteed to work inside a user
  // gesture. Called anywhere else this is a cheap, honest attempt — it
  // succeeds when the tab is already allowed (arriving here from the
  // dashboard usually is) and otherwise leaves `ready` false until a real tap.
  const unlock = useCallback(async () => {
    try {
      ctx.current ??= new AudioContext()
      const ac = ctx.current
      // Without a gesture this promise simply never settles until one
      // arrives, which is exactly the wait we want.
      if (ac.state === 'suspended') await ac.resume()
      const ok = ac.state === 'running'
      setReady(ok)
      return ok
    } catch {
      // No Web Audio in this browser at all.
      return false
    }
  }, [])

  const ding = useCallback(() => {
    // Switched off, or not unlocked yet — the tones would be swallowed
    // anyway, and the header is already saying the board is silent.
    if (!enabled.current) return
    const ac = ctx.current
    if (!ac || ac.state !== 'running') return
    try {
      // An alternating two-tone alarm, not a soft notification chime — this
      // has to cut through a loud, busy kitchen and read as "act now", not
      // "FYI". Square wave for a harsher, more piercing edge than a sine.
      const TONES = [1046, 784, 1046, 784]
      TONES.forEach((freq, i) => {
        const o = i * 0.13
        const osc = ac.createOscillator()
        const g = ac.createGain()
        osc.type = 'square'
        osc.frequency.value = freq
        osc.connect(g).connect(ac.destination)
        g.gain.setValueAtTime(0.0001, ac.currentTime + o)
        g.gain.exponentialRampToValueAtTime(0.35, ac.currentTime + o + 0.008)
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + o + 0.11)
        osc.start(ac.currentTime + o)
        osc.stop(ac.currentTime + o + 0.12)
      })
    } catch {}
  }, [enabled])

  return { ding, unlock, ready }
}

export default function KitchenClient({
  cafeId,
  cafeName,
  tableLabels,
  printingEnabled,
  paperWidth,
  timezone,
}: {
  cafeId: string
  cafeName: string
  tableLabels: Record<string, string>
  printingEnabled: boolean
  paperWidth: '58mm' | '80mm'
  timezone: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const { toast } = useToast()
  const [orders, setOrders] = useState<Order[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [, tick] = useState(0)
  const known = useRef<Set<string>>(new Set())
  // On by default: an alarm nobody has asked to silence is the safe side of
  // this switch. The ref is what ding() reads, so flipping it doesn't rebuild
  // poll and restart its interval — same reason as autoPrintOn below.
  const [soundOn, setSoundOn] = useState(true)
  const soundOnRef = useRef(true)
  const { ding, unlock, ready: audioReady } = useDing(soundOnRef)
  const [cancelling, setCancelling] = useState<Order | null>(null)
  const [cancelSubmitting, setCancelSubmitting] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [printerHealth, setPrinterHealth] = useState<PrinterHealth | null>(null)
  // Latest print_jobs status per order — the queue/bridge print automatically
  // now (see reprintQueued below), so this is the only way staff can tell
  // whether a ticket actually went out without walking to the printer.
  const [printJobs, setPrintJobs] = useState<Record<string, { kind: string; status: string; created_at: string }>>({})
  // Off by default — see AUTO_PRINT_KEY. The ref is what poll() reads, so
  // flipping the switch doesn't rebuild poll and restart its interval.
  const [autoPrint, setAutoPrint] = useState(false)
  const autoPrintOn = useRef(false)
  const autoPrinted = useRef<Set<string>>(new Set())

  useEffect(() => {
    // After mount, never during render: neither storage exists on the server,
    // so reading them inline would render one thing there and another here.
    autoPrinted.current = loadAutoPrinted()
    try {
      const on = localStorage.getItem(AUTO_PRINT_KEY) === '1'
      autoPrintOn.current = on
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAutoPrint(on)
    } catch {
      // Storage unavailable — it stays off, which is the default anyway.
    }
  }, [])

  function toggleAutoPrint(next: boolean) {
    // Everything already on the board counts as handled, so switching this on
    // mid-service never dumps the backlog onto the printer — only orders
    // arriving from this moment print.
    if (next) {
      orders.forEach((o) => autoPrinted.current.add(o.id))
      saveAutoPrinted(autoPrinted.current)
    }
    autoPrintOn.current = next
    setAutoPrint(next)
    try {
      localStorage.setItem(AUTO_PRINT_KEY, next ? '1' : '0')
    } catch {
      // Storage unavailable — the switch works, it just won't be remembered.
    }
    toast(
      next
        ? 'New orders will print from this tab. Turn it off once the bridge is printing again, or every order prints twice.'
        : 'Auto-printing from this tab is off.',
    )
  }

  useEffect(() => {
    let on = true
    try {
      on = localStorage.getItem(SOUND_KEY) !== '0'
    } catch {
      // Storage unavailable — it stays on, which is the default anyway.
    }
    soundOnRef.current = on
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSoundOn(on)
    if (!on) return
    // Remembered as on, but nothing on this page has been touched yet. Try
    // once — walking in from the dashboard carries an earlier gesture and
    // usually just works — and otherwise wait for the first real one, which
    // any tap on the board provides. Until one lands the header offers the
    // Allow-sound button instead of claiming a silent screen is audible.
    void unlock()
    const onGesture = () => void unlock()
    window.addEventListener('pointerdown', onGesture, { once: true })
    window.addEventListener('keydown', onGesture, { once: true })
    return () => {
      window.removeEventListener('pointerdown', onGesture)
      window.removeEventListener('keydown', onGesture)
    }
  }, [unlock])

  // The click that runs this is itself the gesture the browser is waiting
  // for, so it's the one moment audio is guaranteed to be allowed — and the
  // ding is the proof, so staff hear the alarm they're about to rely on.
  const allowSound = useCallback(() => {
    void unlock().then((ok) => {
      if (ok) ding()
    })
  }, [unlock, ding])

  function toggleSound(next: boolean) {
    soundOnRef.current = next
    setSoundOn(next)
    try {
      localStorage.setItem(SOUND_KEY, next ? '1' : '0')
    } catch {
      // Storage unavailable — the switch works, it just won't be remembered.
    }
    if (next) allowSound()
  }

  // Printer status is polled separately and slowly: it must never share a
  // failure path with the order poll, because the tickets have to keep
  // arriving even when every printer in the building is dead.
  useEffect(() => {
    if (!printingEnabled) return
    let alive = true
    async function pollPrinters() {
      const { data } = await supabase.rpc('printer_health', { p_cafe_id: cafeId })
      if (alive && data) setPrinterHealth(data as PrinterHealth)
    }
    void pollPrinters()
    const id = setInterval(pollPrinters, 20000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [supabase, cafeId, printingEnabled])

  // Explicit local fallback: prints here, in this browser, through the OS
  // print dialog against whatever printer Windows already has installed —
  // including one paired over Bluetooth. This is a deliberate manual escape
  // hatch for when the print bridge or the configured printer is offline —
  // the digital KDS board above still works regardless (spec: never stop the
  // order flow because a printer is offline). It is NOT the primary path
  // anymore; that's reprintQueued below, which goes through the same
  // automatic bridge every order already uses.
  // The one place a ticket is built for this browser's print path, so the
  // button below and the auto-print in poll() can never produce different
  // paper for the same order.
  const printOne = useCallback(
    (o: Order, its: Item[]) =>
      printKot({
        kotNumber: o.short_code,
        cafeName,
        tableLabel: o.table_id ? tableLabels[o.table_id] ?? null : null,
        orderType: o.type,
        placedAt: o.created_at,
        timezone,
        paperWidth,
        items: its.map((i) => ({
          qty: i.qty,
          name: i.name,
          modifiers: (i.modifiers ?? []).map((m) => m.name),
        })),
      }),
    [cafeName, tableLabels, timezone, paperWidth],
  )

  async function printNow(o: Order) {
    const its = items.filter((i) => i.order_id === o.id)
    if (its.length === 0) return toast('Nothing to print on this order.', 'error')
    await printOne(o, its)
  }

  // Queues a real print_jobs row (kind='reprint') the same way an automatic
  // KOT does, so it's picked up by whichever printer/bridge is configured —
  // no dependency on this browser tab, this machine, or a printer driver.
  // Wires up reprint_kot(), which already logs kot.reprinted to audit_logs;
  // this is what makes AUTO PRINTED vs REPRINTED a real, auditable
  // distinction rather than just a button label.
  async function reprintQueued(o: Order) {
    const { data, error } = await supabase.rpc('reprint_kot', { p_order_id: o.id })
    if (error) return toast(error.message, 'error')
    const count = typeof data === 'number' ? data : 0
    toast(count > 0 ? `Reprint queued for ${o.short_code}.` : 'No enabled printer to reprint to — check Settings.', count > 0 ? undefined : 'error')
    void poll()
  }

  // Prints the orders that just arrived, one at a time — printKot hands each
  // ticket to a printer or a dialog, and two of those in flight together
  // interleave. Failures are surfaced rather than swallowed: a fallback that
  // quietly stops printing is precisely the failure it exists to prevent.
  const autoPrintNew = useCallback(
    async (fresh: Order[], all: Item[]) => {
      for (const o of fresh) {
        if (autoPrinted.current.has(o.id)) continue
        const its = all.filter((i) => i.order_id === o.id)
        if (its.length === 0) continue
        // Recorded BEFORE the print, not after: the await below lets another
        // poll run, and one ticket sent twice is worse than one that failed
        // loudly.
        autoPrinted.current.add(o.id)
        saveAutoPrinted(autoPrinted.current)
        try {
          await printOne(o, its)
        } catch (e) {
          toast(`${o.short_code} did not auto-print: ${e instanceof Error ? e.message : 'printer error'}`, 'error')
        }
      }
    },
    [printOne, toast],
  )

  const poll = useCallback(async () => {
    const { data: ords } = await supabase
      .from('orders')
      .select('id, short_code, table_id, type, status, total, payment_method, payment_status, created_at')
      .eq('cafe_id', cafeId)
      .in('status', ['placed', 'preparing', 'ready'])
      .order('created_at', { ascending: true })
    if (!ords) return

    const fresh = ords.filter((o) => !known.current.has(o.id))
    // known is empty on the very first poll after a mount, so a page refresh
    // mid-service neither dings nor reprints the whole board.
    const firstLoad = known.current.size === 0
    if (fresh.length && !firstLoad) ding()
    ords.forEach((o) => known.current.add(o.id))
    setOrders(ords as Order[])

    if (ords.length) {
      const { data: its } = await supabase
        .from('order_items')
        .select('id, order_id, name, qty, modifiers')
        .in('order_id', ords.map((o) => o.id))
      if (its) setItems(its as Item[])

      // The fallback path. Three guards, because a double print is the one
      // thing this must never do: `fresh` skips anything this tab has seen
      // before, `firstLoad` skips the whole board on a refresh, and the
      // ledger inside autoPrintNew skips anything already sent.
      if (printingEnabled && autoPrintOn.current && !firstLoad && fresh.length && its) {
        void autoPrintNew(fresh as Order[], its as Item[])
      }

      // Printing itself now happens automatically server-side (the print
      // bridge, independent of this page — see reprintQueued's comment).
      // This is read-only: the latest job per order, purely to show staff
      // whether a ticket actually went out.
      if (printingEnabled) {
        const { data: jobs } = await supabase
          .from('print_jobs')
          .select('order_id, kind, status, created_at')
          .in('order_id', ords.map((o) => o.id))
          .order('created_at', { ascending: true })
        if (jobs) {
          const latest: Record<string, { kind: string; status: string; created_at: string }> = {}
          for (const j of jobs as { order_id: string | null; kind: string; status: string; created_at: string }[]) {
            if (j.order_id) latest[j.order_id] = { kind: j.kind, status: j.status, created_at: j.created_at }
          }
          setPrintJobs(latest)
        }
      }
    } else {
      setItems([])
      setPrintJobs({})
    }
  }, [supabase, cafeId, ding, printingEnabled, autoPrintNew])

  // Realtime is a supplement, not a replacement: it makes a new order or a
  // status change from another device appear instantly instead of waiting
  // up to 3s, but the interval below keeps running underneath it as the
  // backstop that guarantees the board is never silently stale.
  useRealtimeRefresh(supabase, 'orders', cafeId, poll)

  useEffect(() => {
    // poll() is async and only calls setState after its own network
    // round-trip completes — not a synchronous render-phase update.
    void poll()
    const p = setInterval(poll, 3000)
    // Same 30s cadence as the age re-render tick — flagging late tickets is
    // idempotent per order (notifications.order_id), so calling this on
    // every tick just means "a ticket becomes flagged within 30s of crossing
    // 8 minutes", not that it re-flags anything already flagged.
    const t = setInterval(() => {
      tick((n) => n + 1)
      void supabase.rpc('flag_late_tickets', { p_cafe_id: cafeId })
    }, 30000)
    return () => {
      clearInterval(p)
      clearInterval(t)
    }
  }, [poll, supabase, cafeId])

  // A single ding on arrival (above, inside poll()) is easy to miss over
  // kitchen noise. Any order still sitting in 'placed' — not yet Started —
  // keeps ringing on a short interval until a cook accepts it (advance() has
  // moved it to 'preparing') or it's cancelled, whichever comes first. This
  // is level-triggered on the current board state, not edge-triggered on new
  // arrivals, so it also correctly resumes ringing if the page is reopened
  // while orders are still waiting — unlike the arrival ding, which is
  // deliberately silent on first load (see firstLoad in poll()).
  const hasUnaccepted = orders.some((o) => o.status === 'placed')
  useEffect(() => {
    if (!hasUnaccepted) return
    const id = setInterval(ding, 2500)
    return () => clearInterval(id)
  }, [hasUnaccepted, ding])

  async function advance(o: Order) {
    const to = NEXT[o.status].to
    setOrders((list) => (to === 'completed' ? list.filter((x) => x.id !== o.id) : list.map((x) => (x.id === o.id ? { ...x, status: to as Order['status'] } : x))))
    const { error } = await supabase
      .from('orders')
      .update({ status: to, done_at: to === 'completed' ? new Date().toISOString() : null })
      .eq('id', o.id)
    if (error) {
      setOrders((list) => (list.some((x) => x.id === o.id) ? list.map((x) => (x.id === o.id ? { ...x, status: o.status } : x)) : [...list, o]))
      toast(error.message, 'error')
    }
  }

  async function confirmCancel(reason: string) {
    if (!cancelling) return
    setCancelSubmitting(true)
    setCancelError(null)
    const { error } = await supabase.rpc('cancel_order', { p_order_id: cancelling.id, p_reason: reason })
    setCancelSubmitting(false)
    if (error) return setCancelError(error.message)
    setOrders((list) => list.filter((x) => x.id !== cancelling.id))
    toast(`Order ${cancelling.short_code} cancelled.`)
    setCancelling(null)
  }

  const mins = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 60000)

  function printBadge(job?: { kind: string; status: string; created_at: string }): { label: string; cls: string } | null {
    if (!job) return null
    if (job.status === 'failed') return { label: 'Print failed', cls: 'text-destructive' }
    if (job.status === 'pending' || job.status === 'printing') {
      // A LAN-bridge job normally claims within seconds. A non-LAN printer
      // (USB/Bluetooth) is deliberately never claimed by the bridge at all —
      // found live: a real job sat 'pending' for a full day with no signal
      // anything was wrong, since this badge showed the same "Printing…" a
      // genuinely in-flight LAN job gets. Past 2 minutes, say so honestly
      // instead of implying it's still on its way.
      if (mins(job.created_at) >= 2) {
        return { label: 'Not printing automatically — use Print now', cls: 'text-warning' }
      }
      return { label: 'Printing…', cls: 'text-muted-foreground' }
    }
    if (job.status === 'printed') {
      const label = job.kind === 'reprint' ? 'Reprinted' : job.kind === 'kot_update' ? 'Update printed' : 'Printed'
      return { label, cls: 'text-success' }
    }
    return null
  }

  return (
    <div className="w-full min-h-dvh bg-background text-foreground">
      <OfflineBanner variant="kds" />
      <div className="p-5">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">Kitchen</h1>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => toggleSound(!soundOn)}
            aria-pressed={soundOn}
            className={`min-h-11 rounded-[var(--radius)] px-5 font-medium shadow-[var(--shadow-sm)] ${
              soundOn ? 'bg-primary text-primary-foreground' : 'border border-border-strong bg-surface text-muted-foreground'
            }`}
          >
            {soundOn ? 'Sound on' : 'Sound off'}
          </button>
          {/* Shown only while the browser is genuinely refusing to play. One
              tap here is the gesture it wants; so is any other tap on the
              board, so this clears itself the moment the shift starts. */}
          {soundOn && !audioReady && (
            <button onClick={allowSound} className="min-h-11 rounded-[var(--radius)] bg-warning px-5 font-medium text-white shadow-[var(--shadow-sm)]">
              Tap to allow sound
            </button>
          )}
        </div>
      </header>

      <PrinterBanner health={printerHealth} />

      {printingEnabled && (
        <div className={`mb-5 rounded-[var(--radius)] border bg-surface px-3 py-2.5 ${autoPrint ? 'border-warning' : 'border-border'}`}>
          <label className="flex items-start gap-2.5 text-[13px] text-foreground">
            <input
              type="checkbox"
              checked={autoPrint}
              onChange={(e) => toggleAutoPrint(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-border-strong text-primary"
            />
            <span>
              <span className="font-medium">Auto-print new orders from this screen</span>
              <span className="block text-muted-foreground">
                A fallback for when the print bridge is down. While this tab stays open, every new order
                prints itself from this computer.{' '}
                <strong className="text-warning">Leave this on with a working bridge and each order prints
                twice — one ticket from each.</strong>{' '}
                Remembered on this device only, and orders already on the board are never reprinted.
              </span>
              <span className="block text-muted-foreground">
                Each ticket opens the print dialog unless this browser was started with kiosk printing — see
                Settings → KOT printing.
              </span>
            </span>
          </label>
        </div>
      )}

      {orders.length === 0 ? (
        <p className="py-32 text-center text-2xl text-muted-foreground">No open orders</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {orders.map((o) => {
            const age = mins(o.created_at)
            const late = age >= 8
            const its = items.filter((i) => i.order_id === o.id)
            return (
              <section
                key={o.id}
                className={`rounded-[var(--radius-lg)] border bg-surface p-5 shadow-[var(--shadow-sm)] ${
                  late ? 'border-destructive bg-destructive-subtle' : 'border-border'
                }`}
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-4xl font-semibold text-foreground">{o.short_code}</span>
                  <span className={`text-xl ${late ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}>{age}m</span>
                </div>
                <p className="mt-1 text-lg text-muted-foreground">
                  Table {o.table_id ? tableLabels[o.table_id] ?? '—' : '—'}
                  {o.payment_status === 'paid' ? (
                    <span className="ml-2 font-medium text-success">· Paid</span>
                  ) : (
                    <span className="ml-2 font-medium text-warning">
                      · {o.payment_method === 'upi' ? 'UPI pending' : 'Pay at counter'}
                    </span>
                  )}
                  {o.status !== 'placed' && <span className="ml-2 text-muted-foreground">· {o.status}</span>}
                  {printingEnabled && printBadge(printJobs[o.id]) && (
                    <span className={`ml-2 font-medium ${printBadge(printJobs[o.id])!.cls}`}>
                      · {printBadge(printJobs[o.id])!.label}
                    </span>
                  )}
                </p>
                <ul className="my-4 space-y-2 border-y border-border py-4">
                  {its.map((i) => (
                    <li key={i.id} className="flex gap-3 text-2xl text-foreground">
                      <span className="w-8 shrink-0 font-semibold text-primary">{i.qty}×</span>
                      <span>
                        {i.name}
                        {i.modifiers && i.modifiers.length > 0 && (
                          <span className="block text-base text-muted-foreground">
                            {i.modifiers.map((m) => m.name).join(', ')}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <button onClick={() => advance(o)} className="flex-1 rounded-[var(--radius)] bg-primary py-4 text-xl font-semibold text-primary-foreground">
                    {NEXT[o.status].label}
                  </button>
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => { setCancelError(null); setCancelling(o) }}
                    className="flex-1 rounded-[var(--radius)] border border-border-strong py-2 text-sm font-medium text-muted-foreground hover:border-destructive hover:text-destructive"
                  >
                    Cancel order
                  </button>
                  {printingEnabled && (
                    <button
                      onClick={() => void reprintQueued(o)}
                      className="flex-1 rounded-[var(--radius)] border border-border-strong py-2 text-sm font-medium text-muted-foreground hover:border-primary hover:text-primary"
                    >
                      Reprint KOT
                    </button>
                  )}
                </div>
                {printingEnabled && (
                  <button
                    onClick={() => void printNow(o)}
                    className="mt-2 w-full py-1 text-center text-xs font-medium text-muted-foreground underline decoration-dotted hover:text-foreground"
                  >
                    Print now on this device
                  </button>
                )}
              </section>
            )
          })}
        </div>
      )}

      {cancelling && (
        <CancelOrderDialog
          orderLabel={cancelling.short_code}
          submitting={cancelSubmitting}
          error={cancelError}
          onClose={() => setCancelling(null)}
          onConfirm={confirmCancel}
        />
      )}
      </div>
    </div>
  )
}
