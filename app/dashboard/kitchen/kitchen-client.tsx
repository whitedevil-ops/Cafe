'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

function useDing() {
  const ctx = useRef<AudioContext | null>(null)
  return useCallback(() => {
    try {
      ctx.current ??= new AudioContext()
      const ac = ctx.current
      if (ac.state === 'suspended') void ac.resume()
      ;[0, 0.18].forEach((o) => {
        const osc = ac.createOscillator()
        const g = ac.createGain()
        osc.frequency.value = 880
        osc.connect(g).connect(ac.destination)
        g.gain.setValueAtTime(0.0001, ac.currentTime + o)
        g.gain.exponentialRampToValueAtTime(0.5, ac.currentTime + o + 0.01)
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + o + 0.15)
        osc.start(ac.currentTime + o)
        osc.stop(ac.currentTime + o + 0.16)
      })
    } catch {}
  }, [])
}

export default function KitchenClient({
  cafeId,
  tableLabels,
  printingEnabled,
  paperWidth,
  timezone,
}: {
  cafeId: string
  tableLabels: Record<string, string>
  printingEnabled: boolean
  paperWidth: '58mm' | '80mm'
  timezone: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const { toast } = useToast()
  const [orders, setOrders] = useState<Order[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [armed, setArmed] = useState(false)
  const [, tick] = useState(0)
  const known = useRef<Set<string>>(new Set())
  const ding = useDing()
  const [cancelling, setCancelling] = useState<Order | null>(null)
  const [cancelSubmitting, setCancelSubmitting] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [printerHealth, setPrinterHealth] = useState<PrinterHealth | null>(null)
  // Latest print_jobs status per order — the queue/bridge print automatically
  // now (see reprintQueued below), so this is the only way staff can tell
  // whether a ticket actually went out without walking to the printer.
  const [printJobs, setPrintJobs] = useState<Record<string, { kind: string; status: string }>>({})

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
  async function printNow(o: Order) {
    const its = items.filter((i) => i.order_id === o.id)
    if (its.length === 0) return toast('Nothing to print on this order.', 'error')
    await printKot({
      kotNumber: o.short_code,
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
    })
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
          const latest: Record<string, { kind: string; status: string }> = {}
          for (const j of jobs as { order_id: string | null; kind: string; status: string }[]) {
            if (j.order_id) latest[j.order_id] = { kind: j.kind, status: j.status }
          }
          setPrintJobs(latest)
        }
      }
    } else {
      setItems([])
      setPrintJobs({})
    }
  }, [supabase, cafeId, ding, printingEnabled])

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

  function printBadge(job?: { kind: string; status: string }): { label: string; cls: string } | null {
    if (!job) return null
    if (job.status === 'failed') return { label: 'Print failed', cls: 'text-destructive' }
    if (job.status === 'pending' || job.status === 'printing') return { label: 'Printing…', cls: 'text-muted-foreground' }
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
          {!armed && (
            <button onClick={() => { ding(); setArmed(true) }} className="min-h-11 rounded-[var(--radius)] bg-warning px-5 font-medium text-white shadow-[var(--shadow-sm)]">
              Tap to enable sound
            </button>
          )}
        </div>
      </header>

      <PrinterBanner health={printerHealth} />

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
