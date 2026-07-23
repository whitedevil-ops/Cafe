'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Order, OrderItem } from '@/lib/types'
import { OfflineBanner } from '@/components/offline-banner'

type Row = { order: Order; items: OrderItem[]; table_label: string }

// Synthesised rather than an mp3: no asset to fail to load, and a cheap tablet in a
// kitchen with an exhaust fan running needs this loud and mid-range to cut through.
function useDing() {
  const ctx = useRef<AudioContext | null>(null)
  return useCallback(() => {
    try {
      ctx.current ??= new AudioContext()
      const ac = ctx.current
      if (ac.state === 'suspended') void ac.resume()
      ;[0, 0.18].forEach((offset) => {
        const osc = ac.createOscillator()
        const gain = ac.createGain()
        osc.frequency.value = 880
        osc.connect(gain).connect(ac.destination)
        gain.gain.setValueAtTime(0.0001, ac.currentTime + offset)
        gain.gain.exponentialRampToValueAtTime(0.5, ac.currentTime + offset + 0.01)
        gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + offset + 0.15)
        osc.start(ac.currentTime + offset)
        osc.stop(ac.currentTime + offset + 0.16)
      })
    } catch {
      // An audio failure must never take the order board down with it.
    }
  }, [])
}

function minutesAgo(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
}

export default function KdsClient({ slug }: { slug: string }) {
  const [rows, setRows] = useState<Row[]>([])
  const [armed, setArmed] = useState(false)
  const [, forceTick] = useState(0)
  const known = useRef<Set<string>>(new Set())
  const ding = useDing()

  useEffect(() => {
    let alive = true

    async function poll() {
      try {
        const res = await fetch(`/api/orders?slug=${slug}`, { cache: 'no-store' })
        const json = await res.json()
        if (!alive || !json.orders) return
        const next = json.orders as Row[]

        const fresh = next.filter((r) => !known.current.has(r.order.id))
        if (fresh.length && known.current.size > 0) ding()
        next.forEach((r) => known.current.add(r.order.id))

        setRows(next)
      } catch {
        // Cafe wifi drops. Keep the last board on screen and try again in 2s.
      }
    }

    void poll()
    const poller = setInterval(poll, 2000)
    // Re-render once a minute so the elapsed-time counters keep climbing.
    const ticker = setInterval(() => forceTick((n) => n + 1), 30000)
    return () => {
      alive = false
      clearInterval(poller)
      clearInterval(ticker)
    }
  }, [slug, ding])

  async function done(id: string) {
    setRows((prev) => prev.filter((r) => r.order.id !== id))
    await fetch(`/api/orders/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    })
  }

  return (
    <main className="min-h-dvh bg-stone-950 text-white">
      <OfflineBanner variant="kds" />
      <div className="p-5">
      <header className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-medium text-stone-400">Kitchen · {slug}</h1>
        {!armed && (
          <button
            onClick={() => {
              ding()
              setArmed(true)
            }}
            className="rounded-lg bg-amber-500 px-5 py-2.5 font-medium text-stone-950"
          >
            Tap to enable sound
          </button>
        )}
      </header>

      {rows.length === 0 ? (
        <p className="py-32 text-center text-2xl text-stone-600">No open orders</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map(({ order, items, table_label }) => {
            const age = minutesAgo(order.created_at)
            const late = age >= 8
            return (
              <section
                key={order.id}
                className={`rounded-xl border-2 bg-stone-900 p-5 ${
                  late ? 'border-red-500' : 'border-stone-700'
                }`}
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-4xl font-medium tracking-wide">{order.short_code}</span>
                  <span className={`text-xl ${late ? 'text-red-400' : 'text-stone-400'}`}>
                    {age}m
                  </span>
                </div>
                <p className="mt-1 text-lg text-stone-400">
                  Table {table_label} ·{' '}
                  {order.payment_method === 'upi' ? 'Paid' : 'Counter'}
                </p>

                <ul className="my-4 space-y-2 border-y border-stone-800 py-4">
                  {items.map((i) => (
                    <li key={i.id} className="flex gap-3 text-2xl">
                      <span className="w-8 shrink-0 font-medium text-amber-400">{i.qty}×</span>
                      <span>{i.name}</span>
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => done(order.id)}
                  className="w-full rounded-lg bg-emerald-600 py-4 text-xl font-medium"
                >
                  Done
                </button>
              </section>
            )
          })}
        </div>
      )}
      </div>
    </main>
  )
}
