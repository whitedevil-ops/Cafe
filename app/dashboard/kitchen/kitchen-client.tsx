'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { useToast } from '@/components/ui/toast'
import { CancelOrderDialog } from '@/components/orders/cancel-order-dialog'
import { PrinterBanner, type PrinterHealth } from '@/components/kitchen/printer-banner'
import { useRealtimeRefresh } from '@/lib/use-realtime-refresh'
import { OfflineBanner } from '@/components/offline-banner'

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
}: {
  cafeId: string
  tableLabels: Record<string, string>
  printingEnabled: boolean
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

  async function reprint(o: Order) {
    const { data, error } = await supabase.rpc('reprint_kot', { p_order_id: o.id })
    if (error) return toast(error.message, 'error')
    toast(data === 0 ? 'No printer matched this order.' : `KOT re-queued for order ${o.short_code}.`)
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
    if (fresh.length && known.current.size > 0) ding()
    ords.forEach((o) => known.current.add(o.id))
    setOrders(ords as Order[])

    if (ords.length) {
      const { data: its } = await supabase
        .from('order_items')
        .select('id, order_id, name, qty, modifiers')
        .in('order_id', ords.map((o) => o.id))
      if (its) setItems(its as Item[])
    } else {
      setItems([])
    }
  }, [supabase, cafeId, ding])

  // Realtime is a supplement, not a replacement: it makes a new order or a
  // status change from another device appear instantly instead of waiting
  // up to 3s, but the interval below keeps running underneath it as the
  // backstop that guarantees the board is never silently stale.
  useRealtimeRefresh(supabase, 'orders', cafeId, poll)

  useEffect(() => {
    // poll() is async and only calls setState after its own network
    // round-trip completes — not a synchronous render-phase update — but
    // this lint rule can't see past the `void` once poll is a useCallback
    // reference rather than a function declared inline in this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void poll()
    const p = setInterval(poll, 3000)
    const t = setInterval(() => tick((n) => n + 1), 30000)
    return () => {
      clearInterval(p)
      clearInterval(t)
    }
  }, [poll])

  async function advance(o: Order) {
    const to = NEXT[o.status].to
    setOrders((list) => (to === 'completed' ? list.filter((x) => x.id !== o.id) : list.map((x) => (x.id === o.id ? { ...x, status: to as Order['status'] } : x))))
    await supabase
      .from('orders')
      .update({ status: to, done_at: to === 'completed' ? new Date().toISOString() : null })
      .eq('id', o.id)
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

  return (
    <div className="w-full min-h-dvh bg-background text-foreground">
      <OfflineBanner variant="kds" />
      <div className="p-5">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">Kitchen</h1>
        {!armed && (
          <button onClick={() => { ding(); setArmed(true) }} className="min-h-11 rounded-[var(--radius)] bg-warning px-5 font-medium text-white shadow-[var(--shadow-sm)]">
            Tap to enable sound
          </button>
        )}
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
                      onClick={() => reprint(o)}
                      className="flex-1 rounded-[var(--radius)] border border-border-strong py-2 text-sm font-medium text-muted-foreground hover:border-primary hover:text-primary"
                    >
                      Reprint KOT
                    </button>
                  )}
                </div>
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
