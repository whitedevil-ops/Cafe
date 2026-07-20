'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/utils/supabase/client'

type Order = {
  id: string
  short_code: string
  table_id: string | null
  type: string
  status: 'placed' | 'preparing' | 'ready'
  total: number
  payment_method: string | null
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
  const [orders, setOrders] = useState<Order[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [armed, setArmed] = useState(false)
  const [, tick] = useState(0)
  const known = useRef<Set<string>>(new Set())
  const ding = useDing()

  useEffect(() => {
    let alive = true
    async function poll() {
      const { data: ords } = await supabase
        .from('orders')
        .select('id, short_code, table_id, type, status, total, payment_method, created_at')
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

  async function advance(o: Order) {
    const to = NEXT[o.status].to
    setOrders((list) => (to === 'completed' ? list.filter((x) => x.id !== o.id) : list.map((x) => (x.id === o.id ? { ...x, status: to as Order['status'] } : x))))
    await supabase
      .from('orders')
      .update({ status: to, done_at: to === 'completed' ? new Date().toISOString() : null })
      .eq('id', o.id)
  }

  const mins = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 60000)

  return (
    <div className="min-h-dvh bg-stone-950 p-5 text-white">
      <header className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-medium text-stone-400">Kitchen</h1>
        {!armed && (
          <button onClick={() => { ding(); setArmed(true) }} className="rounded-lg bg-amber-500 px-5 py-2.5 font-medium text-stone-950">
            Tap to enable sound
          </button>
        )}
      </header>

      {orders.length === 0 ? (
        <p className="py-32 text-center text-2xl text-stone-600">No open orders</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {orders.map((o) => {
            const age = mins(o.created_at)
            const late = age >= 8
            const its = items.filter((i) => i.order_id === o.id)
            return (
              <section key={o.id} className={`rounded-xl border-2 bg-stone-900 p-5 ${late ? 'border-red-500' : 'border-stone-700'}`}>
                <div className="flex items-baseline justify-between">
                  <span className="text-4xl font-medium">{o.short_code}</span>
                  <span className={`text-xl ${late ? 'text-red-400' : 'text-stone-400'}`}>{age}m</span>
                </div>
                <p className="mt-1 text-lg text-stone-400">
                  Table {o.table_id ? tableLabels[o.table_id] ?? '—' : '—'} · {o.payment_method === 'upi' ? 'Paid' : 'Counter'}
                  {o.status !== 'placed' && <span className="ml-2 text-amber-400">· {o.status}</span>}
                </p>
                <ul className="my-4 space-y-2 border-y border-stone-800 py-4">
                  {its.map((i) => (
                    <li key={i.id} className="flex gap-3 text-2xl">
                      <span className="w-8 shrink-0 font-medium text-amber-400">{i.qty}×</span>
                      <span>
                        {i.name}
                        {i.modifiers && i.modifiers.length > 0 && (
                          <span className="block text-base text-stone-400">
                            {i.modifiers.map((m) => m.name).join(', ')}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                <button onClick={() => advance(o)} className="w-full rounded-lg bg-emerald-600 py-4 text-xl font-medium">
                  {NEXT[o.status].label}
                </button>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
