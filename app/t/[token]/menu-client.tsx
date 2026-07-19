'use client'

import { useMemo, useRef, useState } from 'react'
import type { Cafe, CafeTable, CartLine, MenuItem, Order } from '@/lib/types'
import { pickUpsell, subtotal } from '@/lib/upsell'

type Step = 'menu' | 'cart' | 'placed'

export default function MenuClient({
  cafe,
  table,
  menu,
}: {
  cafe: Cafe
  table: CafeTable
  menu: MenuItem[]
}) {
  const [lines, setLines] = useState<CartLine[]>([])
  const [step, setStep] = useState<Step>('menu')
  const [phone, setPhone] = useState('')
  const [placing, setPlacing] = useState(false)
  const [order, setOrder] = useState<Order | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Latches on first display and never resets. An order where the offer appeared and was
  // ignored is the control group — losing that row makes the day-30 number a lie.
  const upsellShown = useRef(false)
  const upsellTaken = useRef<MenuItem | null>(null)

  const categories = useMemo(
    () => [...new Set(menu.map((m) => m.category))],
    [menu],
  )
  const total = subtotal(lines)
  const upsell = pickUpsell(lines, menu, cafe.upsell_threshold)
  if (upsell && step === 'cart') upsellShown.current = true

  const qtyOf = (id: string) => lines.find((l) => l.item.id === id)?.qty ?? 0

  function add(item: MenuItem, isUpsell = false) {
    if (isUpsell) upsellTaken.current = item
    setLines((prev) => {
      const found = prev.find((l) => l.item.id === item.id)
      if (found) return prev.map((l) => (l.item.id === item.id ? { ...l, qty: l.qty + 1 } : l))
      return [...prev, { item, qty: 1 }]
    })
  }

  function remove(item: MenuItem) {
    setLines((prev) =>
      prev
        .map((l) => (l.item.id === item.id ? { ...l, qty: l.qty - 1 } : l))
        .filter((l) => l.qty > 0),
    )
  }

  async function place(payment_method: 'upi' | 'counter') {
    setPlacing(true)
    setError(null)
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cafe_id: cafe.id,
          table_id: table.id,
          phone: phone || null,
          total,
          payment_method,
          upsell_shown: upsellShown.current,
          upsell_item_id: upsellTaken.current?.id ?? null,
          upsell_taken: Boolean(upsellTaken.current),
          upsell_value: upsellTaken.current?.price ?? 0,
          items: lines.map((l) => ({
            menu_item_id: l.item.id,
            name: l.item.name,
            price: l.item.price,
            qty: l.qty,
          })),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not place order')
      setOrder(json.order)
      setStep('placed')
      if (payment_method === 'upi' && cafe.upi_id) {
        const url = `upi://pay?pa=${cafe.upi_id}&pn=${encodeURIComponent(
          cafe.upi_name ?? cafe.name,
        )}&am=${total}&cu=INR&tn=${encodeURIComponent(`Table ${table.label} · ${json.order.short_code}`)}`
        window.location.href = url
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPlacing(false)
    }
  }

  if (step === 'placed' && order) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 p-6 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-3xl text-emerald-700">
          ✓
        </div>
        <div>
          <h1 className="text-2xl font-medium text-stone-900">Order placed</h1>
          <p className="mt-1 text-stone-500">The kitchen has it. Table {table.label}.</p>
        </div>
        <div className="w-full rounded-xl border border-stone-200 bg-white p-6">
          <p className="text-sm text-stone-500">Your order number</p>
          <p className="mt-1 text-4xl font-medium tracking-wide text-stone-900">
            {order.short_code}
          </p>
          <p className="mt-4 border-t border-stone-100 pt-4 text-lg text-stone-900">
            ₹{order.total}
            <span className="ml-2 text-sm text-stone-500">
              {order.payment_method === 'upi' ? 'paid by UPI' : 'pay at the counter'}
            </span>
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto min-h-dvh max-w-md bg-stone-50 pb-28">
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-white px-5 py-4">
        <h1 className="text-lg font-medium text-stone-900">{cafe.name}</h1>
        <p className="text-sm text-stone-500">Table {table.label}</p>
      </header>

      {step === 'menu' && (
        <>
          <nav className="sticky top-[73px] z-10 flex gap-2 overflow-x-auto border-b border-stone-200 bg-white px-5 py-3">
            {categories.map((c) => (
              <a
                key={c}
                href={`#cat-${c}`}
                className="shrink-0 rounded-full bg-stone-100 px-4 py-1.5 text-sm text-stone-700"
              >
                {c}
              </a>
            ))}
          </nav>

          {categories.map((category) => (
            <section key={category} id={`cat-${category}`} className="scroll-mt-32">
              <h2 className="px-5 pt-6 pb-2 text-sm font-medium tracking-wide text-stone-400 uppercase">
                {category}
              </h2>
              <ul>
                {menu
                  .filter((m) => m.category === category)
                  .map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-4 border-b border-stone-100 bg-white px-5 py-4"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-stone-900">{item.name}</p>
                        <p className="text-sm text-stone-500">₹{item.price}</p>
                      </div>
                      {qtyOf(item.id) === 0 ? (
                        <button
                          onClick={() => add(item)}
                          className="shrink-0 rounded-lg border border-amber-300 bg-amber-50 px-5 py-2 text-sm font-medium text-amber-800"
                        >
                          Add
                        </button>
                      ) : (
                        <div className="flex shrink-0 items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1">
                          <button
                            onClick={() => remove(item)}
                            aria-label={`Remove one ${item.name}`}
                            className="px-2 py-1 text-lg leading-none text-amber-800"
                          >
                            −
                          </button>
                          <span className="w-4 text-center text-sm font-medium text-amber-900">
                            {qtyOf(item.id)}
                          </span>
                          <button
                            onClick={() => add(item)}
                            aria-label={`Add one ${item.name}`}
                            className="px-2 py-1 text-lg leading-none text-amber-800"
                          >
                            +
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </>
      )}

      {step === 'cart' && (
        <div className="p-5">
          <button onClick={() => setStep('menu')} className="mb-4 text-sm text-stone-500">
            ← Add more items
          </button>

          <ul className="overflow-hidden rounded-xl border border-stone-200 bg-white">
            {lines.map((l) => (
              <li
                key={l.item.id}
                className="flex items-center justify-between gap-4 border-b border-stone-100 px-4 py-3 last:border-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-stone-900">{l.item.name}</p>
                  <p className="text-sm text-stone-500">
                    ₹{l.item.price} × {l.qty}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <button
                    onClick={() => remove(l.item)}
                    aria-label={`Remove one ${l.item.name}`}
                    className="px-2 text-lg text-stone-400"
                  >
                    −
                  </button>
                  <span className="w-4 text-center text-sm">{l.qty}</span>
                  <button
                    onClick={() => add(l.item)}
                    aria-label={`Add one ${l.item.name}`}
                    className="px-2 text-lg text-stone-400"
                  >
                    +
                  </button>
                  <span className="w-14 text-right text-stone-900">₹{l.item.price * l.qty}</span>
                </div>
              </li>
            ))}
          </ul>

          {upsell && (
            <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
              <div className="min-w-0">
                <p className="font-medium text-amber-900">
                  {upsell.upsell_pitch ?? `Add ${upsell.name}`}
                </p>
                <p className="text-sm text-amber-700">
                  {upsell.name} · ₹{upsell.price}
                </p>
              </div>
              <button
                onClick={() => add(upsell, true)}
                className="shrink-0 rounded-lg bg-amber-700 px-5 py-2 text-sm font-medium text-white"
              >
                Add
              </button>
            </div>
          )}

          <div className="mt-6">
            <label htmlFor="phone" className="text-sm text-stone-600">
              Phone number
              <span className="ml-1 text-stone-400">— for your bill</span>
            </label>
            <input
              id="phone"
              type="tel"
              inputMode="numeric"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              placeholder="98XXXXXXXX"
              className="mt-2 w-full rounded-lg border border-stone-300 bg-white px-4 py-3 text-stone-900 placeholder:text-stone-400"
            />
          </div>

          {error && (
            <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>
          )}

          <div className="mt-6 flex items-baseline justify-between border-t border-stone-200 pt-4">
            <span className="text-stone-500">Total</span>
            <span className="text-2xl font-medium text-stone-900">₹{total}</span>
          </div>

          <div className="mt-4 space-y-3">
            <button
              disabled={placing || lines.length === 0}
              onClick={() => place('upi')}
              className="w-full rounded-lg bg-stone-900 py-4 font-medium text-white disabled:opacity-40"
            >
              {placing ? 'Placing…' : `Pay ₹${total} by UPI`}
            </button>
            <button
              disabled={placing || lines.length === 0}
              onClick={() => place('counter')}
              className="w-full rounded-lg border border-stone-300 bg-white py-4 font-medium text-stone-700 disabled:opacity-40"
            >
              Pay at the counter
            </button>
          </div>
        </div>
      )}

      {step === 'menu' && lines.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 mx-auto max-w-md border-t border-stone-200 bg-white p-4">
          <button
            onClick={() => setStep('cart')}
            className="flex w-full items-center justify-between rounded-lg bg-stone-900 px-5 py-4 font-medium text-white"
          >
            <span>
              {lines.reduce((n, l) => n + l.qty, 0)} item
              {lines.reduce((n, l) => n + l.qty, 0) > 1 ? 's' : ''} · ₹{total}
            </span>
            <span>View cart →</span>
          </button>
        </div>
      )}
    </main>
  )
}
