'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { Printer, Plus, Trash2, Wifi, Usb, Bluetooth, CircleCheck, CircleAlert, Copy } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { isDesktopApp } from '@/lib/is-desktop'
import { getDesktopPrinter, setDesktopPrinter, listSerialPorts, testPrintNative } from '@/lib/desktop-print'
import { saveBridgeToken, loadBridgeToken, clearBridgeToken } from '@/lib/desktop-bridge'
import {
  isBluetoothSupported,
  getBluetoothPrinter,
  setBluetoothPrinter,
  connectBluetoothPrinter,
  testPrintBluetooth,
} from '@/lib/bluetooth-print'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/datetime'
import PrintQueuePanel from '@/components/kitchen/print-queue-panel'

export type KitchenStation = { id: string; name: string }
export type KotPrinter = {
  id: string
  name: string
  connection_type: 'lan' | 'usb' | 'bluetooth'
  ip_address: string | null
  port: number | null
  paper_width: '58mm' | '80mm'
  station_id: string | null
  auto_print: boolean
  copies: number
  enabled: boolean
  last_seen_at: string | null
  last_error: string | null
}
export type BridgeToken = { id: string; name: string; last_seen_at: string | null }

const BLANK: Omit<KotPrinter, 'id' | 'last_seen_at' | 'last_error'> = {
  name: '',
  connection_type: 'lan',
  ip_address: '',
  port: 9100,
  paper_width: '80mm',
  station_id: null,
  auto_print: true,
  copies: 1,
  enabled: true,
}

const CONN_ICON = { lan: Wifi, usb: Usb, bluetooth: Bluetooth } as const

export default function KotPrintingPanel({
  cafeId,
  timezone,
  canManage,
  initialEnabled,
  initialPrintOnUpdate,
  initialPrinters,
  initialStations,
  initialTokens,
}: {
  cafeId: string
  timezone: string
  canManage: boolean
  initialEnabled: boolean
  initialPrintOnUpdate: boolean
  initialPrinters: KotPrinter[]
  initialStations: KitchenStation[]
  initialTokens: BridgeToken[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const { toast } = useToast()
  const confirm = useConfirm()

  // Read after mount, not during render: the server has no window, so
  // interpolating it inline would render one string on the server and another
  // in the browser. Falls back to the production host until it resolves.
  const [origin, setOrigin] = useState('https://khaopiyo.ventron.in')
  const [desktop, setDesktop] = useState(false)
  const [ports, setPorts] = useState<string[]>([])
  const [serialPort, setSerialPort] = useState('')
  // Whether THIS machine has a bridge token saved locally — separate from
  // the `tokens` list below, which is every token paired to the café from
  // any machine and carries no way to tell which one (if any) is this one.
  const [pairedHere, setPairedHere] = useState(false)
  const [btSupported, setBtSupported] = useState(false)
  const [btPrinter, setBtPrinterState] = useState<{ id: string; name: string } | null>(null)
  const [btBusy, setBtBusy] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin)
    setBtSupported(isBluetoothSupported())
    setBtPrinterState(getBluetoothPrinter())
  }, [])

  const refreshPorts = useCallback(async () => {
    setPorts(await listSerialPorts())
  }, [])

  useEffect(() => {
    if (!isDesktopApp()) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDesktop(true)
    const saved = getDesktopPrinter()
    if (saved?.kind === 'serial') setSerialPort(saved.port)
    void refreshPorts()
    void loadBridgeToken().then((t) => setPairedHere(!!t))
  }, [refreshPorts])

  const [enabled, setEnabled] = useState(initialEnabled)
  const [printOnUpdate, setPrintOnUpdate] = useState(initialPrintOnUpdate)
  const [printers, setPrinters] = useState(initialPrinters)
  const [stations, setStations] = useState(initialStations)
  const [tokens, setTokens] = useState(initialTokens)
  const [draft, setDraft] = useState<typeof BLANK | null>(null)
  const [saving, setSaving] = useState(false)
  const [newToken, setNewToken] = useState<string | null>(null)
  const [newStation, setNewStation] = useState('')
  // Refreshed by the poll below so freshness checks read state, not a live
  // clock during render.
  const [now, setNow] = useState(() => Date.now())

  const refresh = useCallback(async () => {
    const [{ data: p }, { data: s }, { data: t }] = await Promise.all([
      supabase.from('kot_printers').select('*').eq('cafe_id', cafeId).order('name'),
      supabase.from('kitchen_stations').select('id, name').eq('cafe_id', cafeId).order('sort'),
      supabase.from('print_bridge_tokens').select('id, name, last_seen_at').eq('cafe_id', cafeId).is('revoked_at', null),
    ])
    setPrinters((p ?? []) as KotPrinter[])
    setStations((s ?? []) as KitchenStation[])
    setTokens((t ?? []) as BridgeToken[])
  }, [supabase, cafeId])

  // Only poll while printing is on — an off café shouldn't generate traffic.
  useEffect(() => {
    if (!enabled) return
    const id = setInterval(() => { setNow(Date.now()); void refresh() }, 20000)
    return () => clearInterval(id)
  }, [enabled, refresh])

  async function toggleEnabled(next: boolean) {
    setEnabled(next)
    const { error } = await supabase.from('cafes').update({ kot_printing_enabled: next }).eq('id', cafeId)
    if (error) {
      setEnabled(!next)
      return toast(error.message, 'error')
    }
    toast(next ? 'KOT printing enabled.' : 'KOT printing disabled — the digital KDS is unaffected.')
  }

  // Covers both an item added and an item modified after the first KOT
  // already printed — mechanically both produce the same "diff and print
  // the delta" event, so one switch covers both rather than two identical
  // ones. The very first KOT for a new order always prints regardless of
  // this setting; it only affects a KOT UPDATE for a later edit.
  async function togglePrintOnUpdate(next: boolean) {
    setPrintOnUpdate(next)
    const { error } = await supabase.from('cafes').update({ kot_print_on_update: next }).eq('id', cafeId)
    if (error) {
      setPrintOnUpdate(!next)
      return toast(error.message, 'error')
    }
    toast(next ? 'Order edits will queue a KOT UPDATE ticket.' : 'Order edits after the first KOT no longer print.')
  }

  async function savePrinter() {
    if (!draft?.name.trim()) return
    setSaving(true)
    const { error } = await supabase.from('kot_printers').insert({
      cafe_id: cafeId,
      ...draft,
      name: draft.name.trim(),
      ip_address: draft.connection_type === 'lan' ? draft.ip_address?.trim() || null : null,
      port: draft.connection_type === 'lan' ? draft.port : null,
    })
    setSaving(false)
    if (error) return toast(error.message, 'error')
    setDraft(null)
    toast('Printer added.')
    void refresh()
  }

  async function updatePrinter(id: string, patch: Partial<KotPrinter>) {
    setPrinters((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)))
    const { error } = await supabase.from('kot_printers').update(patch).eq('id', id)
    if (error) {
      toast(error.message, 'error')
      void refresh()
    }
  }

  async function removePrinter(p: KotPrinter) {
    const ok = await confirm({
      title: `Remove ${p.name}?`,
      description: 'Orders will keep reaching the digital KDS. Only printing to this device stops.',
      confirmLabel: 'Remove',
      destructive: true,
    })
    if (!ok) return
    const { error } = await supabase.from('kot_printers').delete().eq('id', p.id)
    if (error) return toast(error.message, 'error')
    toast('Printer removed.')
    void refresh()
  }

  // Queues a real test_print() job through the same print_jobs queue and
  // bridge every automatic KOT goes through — this is what proves the queue
  // and bridge actually work end to end, not just that this browser can open
  // a print dialog. Previously this printed straight from the browser, which
  // meant "Test print" could pass even when a LAN printer's bridge path was
  // completely broken (a browser cannot reach a raw TCP printer at all).
  async function runTestPrint(p: KotPrinter) {
    const { error } = await supabase.rpc('test_print', { p_printer_id: p.id })
    if (error) return toast(error.message, 'error')
    toast(`Test ticket queued for ${p.name} — check the printer.`)
  }

  async function connectBt() {
    setBtBusy(true)
    try {
      const info = await connectBluetoothPrinter()
      setBtPrinterState(info)
      toast(`Connected to ${info.name}. Tickets will print here from this device.`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not connect to that printer.', 'error')
    }
    setBtBusy(false)
  }

  function disconnectBt() {
    setBluetoothPrinter(null)
    setBtPrinterState(null)
    toast('Bluetooth printer disconnected — the print dialog will be used instead.')
  }

  async function testBt() {
    setBtBusy(true)
    try {
      await testPrintBluetooth(printers[0]?.paper_width ?? '58mm', timezone)
      toast(`Sent a test ticket to ${btPrinter?.name}.`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not reach the printer.', 'error')
    }
    setBtBusy(false)
  }

  async function addStation() {
    if (!newStation.trim()) return
    const { error } = await supabase
      .from('kitchen_stations')
      .insert({ cafe_id: cafeId, name: newStation.trim(), sort: stations.length })
    if (error) return toast(error.message, 'error')
    setNewStation('')
    void refresh()
  }

  async function pairBridge() {
    const { data, error } = await supabase.rpc('issue_print_bridge_token', {
      p_cafe_id: cafeId,
      p_name: 'Print bridge',
    })
    if (error) return toast(error.message, 'error')
    const token = data as string
    setNewToken(token)
    // Inside the desktop app, this IS the machine the bridge should run on —
    // save it locally too so pairing is one click, not copy-paste into a
    // program that doesn't have its own UI. Still shown/copyable above for
    // re-pairing another machine, or if local save fails for any reason.
    if (desktop) {
      await saveBridgeToken(token)
      setPairedHere(true)
    }
    void refresh()
  }

  async function unpairThisDevice() {
    await clearBridgeToken()
    setPairedHere(false)
    toast('This device will stop polling for print jobs.')
  }

  async function revokeBridge(id: string) {
    const ok = await confirm({
      title: 'Unpair this print bridge?',
      description: 'That computer will stop receiving print jobs immediately.',
      confirmLabel: 'Unpair',
      destructive: true,
    })
    if (!ok) return
    const { error } = await supabase.rpc('revoke_print_bridge_token', { p_token_id: id })
    if (error) return toast(error.message, 'error')
    // Deliberately does NOT clear this machine's local bridge.json: a café
    // can pair more than one machine, and this UI has no way to tell whether
    // the token being revoked here is the one this particular device is
    // running — a revoked token just stops being accepted server-side
    // (bridge_claim_jobs checks revoked_at), so a stale local file is
    // harmless, while guessing wrong and clearing the WRONG machine's
    // pairing would not be.
    toast('Print bridge unpaired.')
    void refresh()
  }

  return (
    <section className="mt-10 rounded-xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-medium text-foreground">
            <Printer size={17} /> KOT printing
          </h2>
          <p className="mt-1 max-w-lg text-[13px] leading-relaxed text-muted-foreground">
            Optional. The digital kitchen display always works and never depends on a printer — leave this
            off and nothing about ordering changes.
          </p>
        </div>
        <button
          role="switch"
          aria-checked={enabled}
          aria-label="KOT printing"
          disabled={!canManage}
          onClick={() => toggleEnabled(!enabled)}
          className={`h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-40 ${enabled ? 'bg-primary' : 'bg-surface-subtle border border-border-strong'}`}
        >
          <span className={`block h-6 w-6 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>

      {!enabled && (
        <p className="mt-4 rounded-[var(--radius)] bg-surface-subtle px-3 py-2.5 text-[12.5px] text-muted-foreground">
          Printing is off. Orders flow to the digital KDS only — no printer required.
        </p>
      )}

      {enabled && (
        <div className="mt-6 space-y-8">
          {/* ── Print-on-edit ──────────────────────────────────────────── */}
          <label className="flex items-start gap-2.5 text-[12.5px] text-foreground">
            <input
              type="checkbox"
              checked={printOnUpdate}
              disabled={!canManage}
              onChange={(e) => togglePrintOnUpdate(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-border-strong text-primary disabled:opacity-40"
            />
            <span>
              <span className="font-medium">Print a KOT UPDATE when an order is edited</span>
              <span className="block text-muted-foreground">
                New orders always print. When off, an item added or changed after the first KOT only shows
                on the digital KDS — nothing new prints for the kitchen.
              </span>
            </span>
          </label>

          {/* ── Bridge pairing ─────────────────────────────────────────── */}
          <div>
            <h3 className="text-[13.5px] font-semibold text-foreground">Print bridge</h3>
            <p className="mt-1 max-w-lg text-[12.5px] leading-relaxed text-muted-foreground">
              This is what makes printing automatic — new orders print on their own, on a LAN printer, with
              no Kitchen tab open and no one clicking Print. Pair the KhaoPiyo desktop app on the counter
              computer once; it keeps polling for jobs in the background for as long as it&apos;s running.
            </p>
            <p className="mt-2 max-w-lg rounded-[var(--radius)] bg-surface-subtle px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
              Without a paired bridge, printing still works — use <strong className="text-foreground">Reprint
              KOT</strong> or <strong className="text-foreground">Print now on this device</strong> on the
              Kitchen screen — but it needs a staff member to act on each order. USB printers print through
              that manual path only; a Bluetooth printer can connect directly to this browser below for a
              one-tap setup; the automatic bridge covers LAN/Wi-Fi printers.
            </p>

            {tokens.length === 0 ? (
              <p className="mt-3 rounded-[var(--radius)] border border-warning bg-warning-subtle px-3 py-2 text-[12.5px] text-warning">
                No bridge paired yet — tickets won&apos;t print automatically until one connects. Use Reprint
                KOT or Print now on this device in the meantime.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {tokens.map((t) => {
                  // `now` is state refreshed by the poll below, never Date.now()
                  // read during render — that would make this component impure.
                  const online = t.last_seen_at && now - new Date(t.last_seen_at).getTime() < 120000
                  return (
                    <li key={t.id} className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-border-strong px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                          {online ? <CircleCheck size={13} className="text-success" /> : <CircleAlert size={13} className="text-warning" />}
                          {t.name}
                        </p>
                        <p className="text-[11.5px] text-muted-foreground">
                          {t.last_seen_at ? `Last seen ${formatDateTime(t.last_seen_at, timezone)}` : 'Never connected'}
                        </p>
                      </div>
                      {canManage && (
                        <button onClick={() => revokeBridge(t.id)} className="shrink-0 text-[12px] text-destructive hover:underline">
                          Unpair
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}

            {desktop && (
              <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-foreground">
                {pairedHere ? <CircleCheck size={13} className="text-success" /> : <CircleAlert size={13} className="text-muted-foreground" />}
                This device is {pairedHere ? 'paired — it will print automatically while this app is open.' : 'not paired yet.'}
                {pairedHere && (
                  <button onClick={() => void unpairThisDevice()} className="ml-1 text-destructive underline">
                    Unpair this device
                  </button>
                )}
              </p>
            )}

            {canManage && (
              <Button variant="secondary" size="sm" className="mt-3" onClick={pairBridge}>
                Pair {desktop ? 'this device' : 'a new bridge'}
              </Button>
            )}

            {newToken && (
              <div className="mt-3 rounded-[var(--radius)] border border-primary bg-primary-subtle p-3">
                <p className="text-[12.5px] font-medium text-primary">
                  {desktop
                    ? 'This device is paired. To pair another computer, copy this token and paste it there.'
                    : 'Open Settings → KOT printing on the café computer’s desktop app and pair from there — this token is shown once and never again.'}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-surface px-2 py-1.5 text-[11.5px] text-foreground">{newToken}</code>
                  <button
                    onClick={() => { void navigator.clipboard.writeText(newToken); toast('Token copied.') }}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-border-strong text-foreground"
                    aria-label="Copy token"
                  >
                    <Copy size={14} />
                  </button>
                </div>
                <button onClick={() => setNewToken(null)} className="mt-2 text-[11.5px] text-primary underline">
                  I&apos;ve saved it — hide
                </button>
              </div>
            )}
          </div>

          {/* ── Bluetooth printer (this device) ───────────────────────────
              Prints straight from THIS browser over Web Bluetooth — no
              desktop app, no OS-level pairing, no driver needed first. Only
              in Chrome/Edge on Android, Windows, macOS and Linux; Apple
              blocks the API entirely, so this is hidden on iPhone/iPad and
              Safari, where the print-dialog path (below the fold, via
              "Print now on this device") is still the way in. */}
          {btSupported && (
            <div className="rounded-[var(--radius)] border border-primary bg-primary-subtle p-3">
              <h3 className="flex items-center gap-1.5 text-[13.5px] font-semibold text-primary">
                <Bluetooth size={14} /> Bluetooth printer (this device)
              </h3>
              <p className="mt-1 max-w-lg text-[12px] leading-relaxed text-foreground">
                Connect a Bluetooth thermal printer directly to this browser — no pairing in Windows/Android
                settings first, no driver. Tap Connect, pick your printer from the list that pops up, done.
              </p>
              {btPrinter ? (
                <p className="mt-2.5 flex flex-wrap items-center gap-2 text-[12.5px] text-foreground">
                  <CircleCheck size={13} className="text-success" /> Connected to <strong>{btPrinter.name}</strong>
                  <Button variant="secondary" size="sm" onClick={testBt} loading={btBusy}>Test print</Button>
                  <button onClick={disconnectBt} className="text-[12px] text-destructive hover:underline">Disconnect</button>
                </p>
              ) : (
                <div className="mt-2.5">
                  <Button variant="secondary" size="sm" onClick={connectBt} loading={btBusy}>
                    <Bluetooth size={14} /> Connect Bluetooth printer
                  </Button>
                </div>
              )}
              <p className="mt-2 text-[11.5px] text-muted-foreground">
                If your printer isn&apos;t found or connecting fails, its Bluetooth profile isn&apos;t one we
                recognise yet — fall back to pairing it in your device&apos;s Bluetooth settings and using the
                print dialog instead, and let us know the printer model so we can add support for it.
              </p>
            </div>
          )}

          {/* ── Stations ───────────────────────────────────────────────── */}
          <div>
            <h3 className="text-[13.5px] font-semibold text-foreground">Kitchen stations</h3>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              Optional. Assign a station to a menu category, then point a printer at that station. With no
              stations, every printer receives the whole ticket.
            </p>
            {stations.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {stations.map((s) => (
                  <span key={s.id} className="rounded-full bg-surface-subtle px-3 py-1 text-[12.5px] text-foreground">{s.name}</span>
                ))}
              </div>
            )}
            {canManage && (
              <div className="mt-2 flex gap-2">
                <input
                  value={newStation}
                  onChange={(e) => setNewStation(e.target.value)}
                  placeholder="e.g. Coffee Station"
                  className="h-10 flex-1 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[13px] text-foreground placeholder:text-muted-foreground"
                />
                <Button variant="secondary" size="sm" onClick={addStation} disabled={!newStation.trim()}>Add</Button>
              </div>
            )}
          </div>

          {/* Only inside the desktop app, and only there because this is a
              property of the machine: two counters running the same café get
              different COM ports from Windows, so it cannot live in the
              database with the printer. */}
          {desktop && (
            <div className="rounded-[var(--radius)] border border-primary bg-primary-subtle p-3">
              <h3 className="text-[13.5px] font-semibold text-primary">Direct printing (this computer)</h3>
              <p className="mt-1 max-w-lg text-[12px] leading-relaxed text-foreground">
                The desktop app can send tickets straight to the printer — no print dialog, and no Windows
                driver needed. Pick the port Windows gave your printer when you paired it.
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <select
                  value={serialPort}
                  onChange={(e) => {
                    const port = e.target.value
                    setSerialPort(port)
                    setDesktopPrinter(port ? { kind: 'serial', port } : null)
                    toast(port ? `Tickets will print to ${port}.` : 'Direct printing off — the print dialog will be used.')
                  }}
                  className="h-9 rounded-[var(--radius)] border border-border-strong bg-surface px-2.5 text-[13px] text-foreground"
                >
                  <option value="">Off — use the print dialog</option>
                  {ports.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <Button variant="secondary" size="sm" onClick={() => void refreshPorts()}>Rescan</Button>
                {serialPort && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      try {
                        await testPrintNative(printers[0]?.paper_width ?? '58mm', timezone)
                        toast(`Sent a test ticket to ${serialPort}.`)
                      } catch (e) {
                        toast(e instanceof Error ? e.message : 'Could not reach the printer.', 'error')
                      }
                    }}
                  >
                    Test this port
                  </Button>
                )}
              </div>
              {ports.length === 0 && (
                <p className="mt-2 text-[11.5px] text-foreground">
                  No COM ports found. Pair the printer in Windows Bluetooth settings first, then Rescan.
                </p>
              )}
            </div>
          )}

          {/* Collapsed by default: a café only needs this once, but when they
              need it they are standing at the counter, not reading the repo. */}
          <details className="rounded-[var(--radius)] border border-border-strong px-3 py-2.5">
            <summary className="cursor-pointer text-[13px] font-medium text-foreground">
              Using &ldquo;Print now on this device&rdquo; without a dialog every time
            </summary>
            <div className="mt-3 space-y-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
              <p>
                Pairing a print bridge above is the recommended way to print automatically. This is only for
                the manual fallback button on the Kitchen screen, for a printer the bridge doesn&apos;t cover
                (USB/Bluetooth) or while no bridge is paired yet — one-time setup so that button skips the
                preview window too.
              </p>
              <p>
                <strong className="text-foreground">1.</strong> In Windows → Printers &amp; scanners, turn
                <strong className="text-foreground"> off</strong> &ldquo;Let Windows manage my default
                printer&rdquo;, then set the thermal printer as default. With no dialog there is nothing to
                catch a mistake — every ticket goes to whatever is default.
              </p>
              <p>
                <strong className="text-foreground">2.</strong> Make a desktop shortcut to:
              </p>
              <code className="block overflow-x-auto whitespace-pre rounded-[var(--radius-sm)] bg-surface-subtle px-2.5 py-2 font-mono text-[11.5px] text-foreground">
                {`"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --kiosk-printing --app=${origin}/dashboard/kitchen`}
              </code>
              <p>
                <strong className="text-foreground">3.</strong> Close <em>every</em> Chrome window first,
                including any in the system tray, then open the shortcut. Chrome reads that setting only
                when its first window starts — if one is already open, the shortcut silently joins it and
                the dialog comes back.
              </p>
            </div>
          </details>

          {/* ── Printers ───────────────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-[13.5px] font-semibold text-foreground">Printers</h3>
              {canManage && !draft && (
                <Button variant="secondary" size="sm" onClick={() => setDraft({ ...BLANK })}>
                  <Plus size={14} /> Add printer
                </Button>
              )}
            </div>

            {printers.length === 0 && !draft && (
              <p className="mt-3 text-[13px] text-muted-foreground">No printers configured yet.</p>
            )}

            <ul className="mt-3 space-y-2">
              {printers.map((p) => {
                const Icon = CONN_ICON[p.connection_type]
                return (
                  <li key={p.id} className="rounded-[var(--radius)] border border-border-strong p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-[13.5px] font-medium text-foreground">
                          <Icon size={14} className="text-muted-foreground" />
                          {p.name}
                          {!p.enabled && <span className="text-[11px] text-muted-foreground">(disabled)</span>}
                        </p>
                        <p className="mt-0.5 text-[12px] text-muted-foreground">
                          {p.connection_type === 'lan' ? `${p.ip_address ?? '—'}:${p.port ?? 9100}` : p.connection_type.toUpperCase()}
                          {' · '}{p.paper_width}
                          {' · '}{stations.find((s) => s.id === p.station_id)?.name ?? 'All items'}
                          {' · '}{p.copies} cop{p.copies === 1 ? 'y' : 'ies'}
                          {p.auto_print ? ' · Auto print' : ' · Manual only'}
                        </p>
                        {/* Adding a printer only writes down its settings — a
                            browser cannot reach a thermal printer to check that
                            anything is there, which is the whole reason the
                            bridge exists. So say so, rather than letting a
                            saved row imply a working connection. last_seen_at
                            is stamped by /api/print/report, so it means a job
                            genuinely came out. */}
                        <p className={`mt-1 flex items-center gap-1.5 text-[11.5px] ${p.last_seen_at ? 'text-success' : 'text-muted-foreground'}`}>
                          {p.last_seen_at
                            ? <><CircleCheck size={12} /> Last printed {formatDateTime(p.last_seen_at, timezone)}</>
                            : <><CircleAlert size={12} /> Not verified — nothing has printed from this device yet. Saving it only records the settings.</>}
                        </p>
                        {p.last_error && (
                          <p className="mt-1 text-[11.5px] text-destructive">Last error: {p.last_error}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button onClick={() => runTestPrint(p)} className="text-[12px] text-primary hover:underline">Test print</button>
                        {canManage && (
                          <>
                            <button
                              onClick={() => updatePrinter(p.id, { enabled: !p.enabled })}
                              className="text-[12px] text-muted-foreground hover:text-foreground"
                            >
                              {p.enabled ? 'Disable' : 'Enable'}
                            </button>
                            <button
                              onClick={() => updatePrinter(p.id, { auto_print: !p.auto_print })}
                              className="text-[12px] text-muted-foreground hover:text-foreground"
                            >
                              {p.auto_print ? 'Disable auto' : 'Enable auto'}
                            </button>
                            <button onClick={() => removePrinter(p)} aria-label={`Remove ${p.name}`} className="text-muted-foreground hover:text-destructive">
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>

            {draft && (
              <div className="mt-3 rounded-[var(--radius)] border border-primary p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Printer name">
                    <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      placeholder="Main Kitchen Printer" className={inputCls} />
                  </Field>
                  <Field label="Connection">
                    <select value={draft.connection_type}
                      onChange={(e) => setDraft({ ...draft, connection_type: e.target.value as KotPrinter['connection_type'] })}
                      className={inputCls}>
                      {/* All three print, because none of them are reached by
                          this app: Windows owns the connection and the browser
                          prints to whatever it exposes. The field is kept
                          because it is how a café thinks about its printer, and
                          because a future bridge will need to know. */}
                      <option value="lan">LAN / Wi-Fi</option>
                      <option value="usb">USB</option>
                      <option value="bluetooth">Bluetooth</option>
                    </select>
                  </Field>
                  <p className="text-[11.5px] leading-relaxed text-muted-foreground sm:col-span-2">
                    However it connects, pair or plug the printer into this computer first and install its
                    driver, so it appears in Windows under <strong className="text-foreground">Printers &amp;
                    scanners</strong> — not just under Bluetooth devices. Tickets are printed by this
                    browser, so any printer Windows can see will work, Bluetooth included. If pairing left
                    it listed only as a device, Windows has no driver for it yet and nothing will print
                    until one is installed.
                  </p>
                  {draft.connection_type === 'lan' && (
                    <>
                      <Field label="IP address">
                        <input value={draft.ip_address ?? ''} onChange={(e) => setDraft({ ...draft, ip_address: e.target.value })}
                          placeholder="192.168.1.50" className={inputCls} />
                      </Field>
                      <Field label="Port">
                        <input type="number" value={draft.port ?? 9100}
                          onChange={(e) => setDraft({ ...draft, port: Number(e.target.value) })} className={inputCls} />
                      </Field>
                    </>
                  )}
                  <Field label="Paper width">
                    <select value={draft.paper_width}
                      onChange={(e) => setDraft({ ...draft, paper_width: e.target.value as '58mm' | '80mm' })} className={inputCls}>
                      <option value="80mm">80mm</option>
                      <option value="58mm">58mm</option>
                    </select>
                  </Field>
                  <Field label="Kitchen station">
                    <select value={draft.station_id ?? ''}
                      onChange={(e) => setDraft({ ...draft, station_id: e.target.value || null })} className={inputCls}>
                      <option value="">All items</option>
                      {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Copies">
                    <input type="number" min={1} max={5} value={draft.copies}
                      onChange={(e) => setDraft({ ...draft, copies: Math.min(5, Math.max(1, Number(e.target.value))) })} className={inputCls} />
                  </Field>
                  <Field label="Auto print new orders">
                    <select value={draft.auto_print ? 'on' : 'off'}
                      onChange={(e) => setDraft({ ...draft, auto_print: e.target.value === 'on' })} className={inputCls}>
                      <option value="on">On</option>
                      <option value="off">Off</option>
                    </select>
                  </Field>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setDraft(null)}>Cancel</Button>
                  <Button size="sm" onClick={savePrinter} loading={saving} disabled={!draft.name.trim()}>Add printer</Button>
                </div>
              </div>
            )}
          </div>

          <PrintQueuePanel cafeId={cafeId} timezone={timezone} />
        </div>
      )}
    </section>
  )
}

const inputCls =
  'h-10 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[13px] text-foreground placeholder:text-muted-foreground'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11.5px] text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}
