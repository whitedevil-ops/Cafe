'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { useToast } from '@/components/ui/toast'
import { CancelOrderDialog } from '@/components/orders/cancel-order-dialog'

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
}: {
  cafeId: string
  tableLabels: Record<string, string>
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

  useEffect(() => {
    let alive = true
    async function poll() {
      const { data: ords } = await supabase
        .from('orders')
        .select('id, short_code, table_id, type, status, total, payment_method, payment_status, created_at')
        .eq('cafe_id', cafeId)
        .in('status', ['placed', 'preparing', 'ready'])
        .order('created_at', { ascending: true })
      if (!alive || !ords) return

      const fresh = ords.filter((o) => !known.current.has(o.id))
      if (fresh.length && known.current.size > 0) ding()
      ords.forEach((o) => known.current.add(o.id))
      setOrders(ords as Order[])

      if (ords.length) {
        const { data: its } = await supabase
          .from('order_items')
          .select('id, order_id, name, qty, modifiers')
          .in('order_id', ords.map((o) => o.id))
        if (alive && its) setItems(its as Item[])
      } else {
        setItems([])
      }
    }
    void poll()
    const p = setInterval(poll, 3000)
    const t = setInterval(() => tick((n) => n + 1), 30000)
    return () => {
      alive = false
      clearInterval(p)
      clearInterval(t)
    }
  }, [supabase, cafeId, ding])

  async function markPaid(o: Order) {
    setOrders((list) => list.map((x) => (x.id === o.id ? { ...x, payment_status: 'paid' } : x)))
    // Record the money, then flip the order — the payments row is the audit trail.
    const { error } = await supabase.from('payments').insert({
      cafe_id: cafeId,
      order_id: o.id,
      method: o.payment_method === 'upi' ? 'upi' : 'cash',
      amount: o.total,
    })
    if (error) {
      setOrders((list) => list.map((x) => (x.id === o.id ? { ...x, payment_status: 'unpaid' } : x)))
      return
    }
    await supabase.from('orders').update({ payment_status: 'paid' }).eq('id', o.id)
  }

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
    <div className="w-full min-h-dvh bg-background p-5 text-foreground">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">Kitchen</h1>
        {!armed && (
          <button onClick={() => { ding(); setArmed(true) }} className="min-h-11 rounded-[var(--radius)] bg-warning px-5 font-medium text-white shadow-[var(--shadow-sm)]">
            Tap to enable sound
          </button>
        )}
      </header>

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
                  {o.payment_status !== 'paid' && (
                    <button onClick={() => markPaid(o)} className="flex-1 rounded-[var(--radius)] border border-warning py-4 text-lg font-medium text-warning">
                      ₹{o.total} paid
                    </button>
                  )}
                  <button onClick={() => advance(o)} className="flex-1 rounded-[var(--radius)] bg-primary py-4 text-xl font-semibold text-primary-foreground">
                    {NEXT[o.status].label}
                  </button>
                </div>
                <button
                  onClick={() => { setCancelError(null); setCancelling(o) }}
                  className="mt-2 w-full rounded-[var(--radius)] border border-border-strong py-2 text-sm font-medium text-muted-foreground hover:border-destructive hover:text-destructive"
                >
                  Cancel order
                </button>
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
  )
}
