'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Printer, Plus, Trash2, Wifi, Usb, Bluetooth, CircleCheck, CircleAlert, Copy } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/datetime'

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
  initialPrinters,
  initialStations,
  initialTokens,
}: {
  cafeId: string
  timezone: string
  canManage: boolean
  initialEnabled: boolean
  initialPrinters: KotPrinter[]
  initialStations: KitchenStation[]
  initialTokens: BridgeToken[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const { toast } = useToast()
  const confirm = useConfirm()

  const [enabled, setEnabled] = useState(initialEnabled)
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

  async function runTestPrint(p: KotPrinter) {
    const { error } = await supabase.rpc('test_print', { p_printer_id: p.id })
    if (error) return toast(error.message, 'error')
    toast(`Test page queued for ${p.name}. It prints when the bridge next polls.`)
    void refresh()
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
    setNewToken(data as string)
    void refresh()
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
          {/* ── Bridge pairing ─────────────────────────────────────────── */}
          <div>
            <h3 className="text-[13.5px] font-semibold text-foreground">Print bridge</h3>
            <p className="mt-1 max-w-lg text-[12.5px] leading-relaxed text-muted-foreground">
              Thermal printers can&apos;t be reached directly from a browser. A small KhaoPiyo Print Bridge
              runs on the café&apos;s computer, collects jobs, and sends them to the printer on your local
              network. No cloud printing subscription.
            </p>

            {tokens.length === 0 ? (
              <p className="mt-3 rounded-[var(--radius)] border border-warning bg-warning-subtle px-3 py-2 text-[12.5px] text-warning">
                No bridge paired yet — jobs will queue until one connects.
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

            {canManage && (
              <Button variant="secondary" size="sm" className="mt-3" onClick={pairBridge}>
                Pair a new bridge
              </Button>
            )}

            {newToken && (
              <div className="mt-3 rounded-[var(--radius)] border border-primary bg-primary-subtle p-3">
                <p className="text-[12.5px] font-medium text-primary">
                  Paste this into the Print Bridge on the café&apos;s computer. It is shown once and never again.
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
                        {p.last_error && (
                          <p className="mt-1 text-[11.5px] text-destructive">Last error: {p.last_error}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button onClick={() => runTestPrint(p)} className="text-[12px] text-primary hover:underline">Test print</button>
                        {canManage && (
                          <>
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
                      <option value="lan">LAN / Wi-Fi</option>
                      <option value="usb">USB (via bridge)</option>
                      <option value="bluetooth">Bluetooth (experimental)</option>
                    </select>
                  </Field>
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
