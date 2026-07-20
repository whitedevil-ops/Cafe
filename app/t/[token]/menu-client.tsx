'use client'

import { useMemo, useRef, useState } from 'react'
import { createClient } from '@/utils/supabase/client'

export type PublicItem = {
  id: string
  name: string
  description: string | null
  price: number
  category_id: string | null
  is_veg: boolean | null
  is_bestseller: boolean
  is_upsell: boolean
  upsell_pitch: string | null
}

type Cart = Record<string, number>

export default function MenuClient({
  token,
  cafeName,
  tableLabel,
  upsellThreshold,
  categories,
  items,
}: {
  token: string
  cafeName: string
  tableLabel: string
  upsellThreshold: number
  categories: { id: string; name: string }[]
  items: PublicItem[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const [cart, setCart] = useState<Cart>({})
  const [step, setStep] = useState<'menu' | 'cart' | 'done'>('menu')
  const [phone, setPhone] = useState('')
  const [placing, setPlacing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [placed, setPlaced] = useState<{ code: string; total: number } | null>(null)

  const upsellShown = useRef(false)
  const upsellTaken = useRef<string | null>(null)

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const cats = useMemo(() => {
    const withItems = categories.filter((c) => items.some((i) => i.category_id === c.id))
    const uncategorised = items.some((i) => !i.category_id)
    return uncategorised ? [...withItems, { id: '__none', name: 'Other' }] : withItems
  }, [categories, items])

  const lines = Object.entries(cart).filter(([, q]) => q > 0)
  const subtotal = lines.reduce((s, [id, q]) => s + (byId.get(id)?.price ?? 0) * q, 0)
  const count = lines.reduce((s, [, q]) => s + q, 0)

  const upsell = useMemo(() => {
    if (count === 0 || subtotal < upsellThreshold) return null
    if (lines.some(([id]) => byId.get(id)?.is_upsell)) return null
    const cand = items.filter((i) => i.is_upsell)
    return cand.length ? cand.reduce((a, b) => (a.price <= b.price ? a : b)) : null
  }, [count, subtotal, upsellThreshold, lines, items, byId])
  if (upsell && step === 'cart') upsellShown.current = true

  const add = (id: string, isUpsell = false) => {
    if (isUpsell) upsellTaken.current = id
    setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }))
  }
  const remove = (id: string) => setCart((c) => ({ ...c, [id]: Math.max(0, (c[id] ?? 0) - 1) }))

  async function place(method: 'upi' | 'counter') {
    setPlacing(true)
    setError(null)
    const { data, error } = await supabase.rpc('place_order', {
      p_token: token,
      p_items: lines.map(([item_id, qty]) => ({ item_id, qty })),
      p_phone: phone || null,
      p_payment_method: method,
      p_upsell_item_id: upsellTaken.current,
      p_upsell_shown: upsellShown.current,
    })
    setPlacing(false)
    if (error) return setError(error.message)
    const result = data as { short_code: string; total: number }
    setPlaced({ code: result.short_code, total: result.total })
    setStep('done')
  }

  if (step === 'done' && placed) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 p-6 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-full bg-success-subtle text-2xl text-success">✓</div>
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Order placed</h1>
          <p className="mt-1 text-muted-foreground">The kitchen has it. Table {tableLabel}.</p>
        </div>
        <div className="w-full rounded-xl border border-border bg-surface p-6">
          <p className="text-sm text-muted-foreground">Order number</p>
          <p className="mt-1 text-4xl font-semibold text-foreground">{placed.code}</p>
          <p className="mt-4 border-t border-border pt-4 text-lg text-foreground">₹{placed.total}</p>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto min-h-dvh max-w-md bg-background pb-28">
      <header className="sticky top-0 z-10 border-b border-border bg-surface px-5 py-4">
        <h1 className="text-lg font-semibold text-foreground">{cafeName}</h1>
        <p className="text-sm text-muted-foreground">Table {tableLabel}</p>
      </header>

      {step === 'menu' &&
        cats.map((cat) => {
          const catItems = items.filter((i) =>
            cat.id === '__none' ? !i.category_id : i.category_id === cat.id,
          )
          if (!catItems.length) return null
          return (
            <section key={cat.id}>
              <h2 className="px-5 pt-6 pb-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
                {cat.name}
              </h2>
              <ul>
                {catItems.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-4 border-b border-border bg-surface px-5 py-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-foreground">{item.name}</p>
                        {item.is_bestseller && (
                          <span className="rounded bg-warning-subtle px-1.5 py-0.5 text-[11px] font-medium text-warning">Bestseller</span>
                        )}
                      </div>
                      {item.description && <p className="truncate text-[13px] text-muted-foreground">{item.description}</p>}
                      <p className="text-sm text-muted-foreground">₹{item.price}</p>
                    </div>
                    {(cart[item.id] ?? 0) === 0 ? (
                      <button onClick={() => add(item.id)} className="shrink-0 rounded-[var(--radius)] border border-primary bg-primary-subtle px-5 py-2 text-sm font-medium text-primary">
                        Add
                      </button>
                    ) : (
                      <div className="flex shrink-0 items-center gap-3 rounded-[var(--radius)] border border-primary bg-primary-subtle px-2 py-1">
                        <button onClick={() => remove(item.id)} aria-label={`Remove one ${item.name}`} className="px-2 text-lg text-primary">−</button>
                        <span className="w-4 text-center text-sm font-medium text-primary">{cart[item.id]}</span>
                        <button onClick={() => add(item.id)} aria-label={`Add one ${item.name}`} className="px-2 text-lg text-primary">+</button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )
        })}

      {step === 'cart' && (
        <div className="p-5">
          <button onClick={() => setStep('menu')} className="mb-4 text-sm text-muted-foreground">← Add more items</button>
          <ul className="overflow-hidden rounded-xl border border-border bg-surface">
            {lines.map(([id, q]) => {
              const item = byId.get(id)!
              return (
                <li key={id} className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 last:border-0">
                  <div className="min-w-0">
                    <p className="truncate text-foreground">{item.name}</p>
                    <p className="text-sm text-muted-foreground">₹{item.price} × {q}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <button onClick={() => remove(id)} aria-label={`Remove one ${item.name}`} className="px-2 text-lg text-muted-foreground">−</button>
                    <span className="w-4 text-center text-sm">{q}</span>
                    <button onClick={() => add(id)} aria-label={`Add one ${item.name}`} className="px-2 text-lg text-muted-foreground">+</button>
                    <span className="w-14 text-right text-foreground">₹{item.price * q}</span>
                  </div>
                </li>
              )
            })}
          </ul>

          {upsell && (
            <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-primary bg-primary-subtle p-4">
              <div className="min-w-0">
                <p className="font-medium text-primary">{upsell.upsell_pitch ?? `Add ${upsell.name}`}</p>
                <p className="text-sm text-primary">{upsell.name} · ₹{upsell.price}</p>
              </div>
              <button onClick={() => add(upsell.id, true)} className="shrink-0 rounded-[var(--radius)] bg-primary px-5 py-2 text-sm font-medium text-primary-foreground">Add</button>
            </div>
          )}

          <div className="mt-6">
            <label htmlFor="phone" className="text-sm text-muted-foreground">Phone number <span className="text-muted-foreground">— for your bill</span></label>
            <input id="phone" type="tel" inputMode="numeric" value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              placeholder="98XXXXXXXX"
              className="mt-2 h-11 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-4 text-foreground placeholder:text-muted-foreground" />
          </div>

          {error && <p className="mt-4 rounded-[var(--radius)] bg-destructive-subtle p-3 text-sm text-destructive">{error}</p>}

          <div className="mt-6 flex items-baseline justify-between border-t border-border pt-4">
            <span className="text-muted-foreground">Total</span>
            <span className="text-2xl font-semibold text-foreground">₹{subtotal}</span>
          </div>

          <div className="mt-4 space-y-3">
            <button disabled={placing || count === 0} onClick={() => place('upi')}
              className="w-full rounded-[var(--radius)] bg-foreground py-4 font-medium text-background disabled:opacity-40">
              {placing ? 'Placing…' : `Pay ₹${subtotal} by UPI`}
            </button>
            <button disabled={placing || count === 0} onClick={() => place('counter')}
              className="w-full rounded-[var(--radius)] border border-border-strong bg-surface py-4 font-medium text-foreground disabled:opacity-40">
              Pay at the counter
            </button>
          </div>
        </div>
      )}

      {step === 'menu' && count > 0 && (
        <div className="fixed inset-x-0 bottom-0 mx-auto max-w-md border-t border-border bg-surface p-4">
          <button onClick={() => setStep('cart')} className="flex w-full items-center justify-between rounded-[var(--radius)] bg-foreground px-5 py-4 font-medium text-background">
            <span>{count} item{count > 1 ? 's' : ''} · ₹{subtotal}</span>
            <span>View cart →</span>
          </button>
        </div>
      )}
    </main>
  )
}
