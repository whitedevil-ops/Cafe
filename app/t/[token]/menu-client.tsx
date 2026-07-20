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
export type Variant = { id: string; menu_item_id: string; name: string; price_delta: number }
export type Addon = { id: string; menu_item_id: string; name: string; price: number }

type Line = {
  key: string
  itemId: string
  name: string
  variantId: string | null
  addonIds: string[]
  modLabel: string
  unitPrice: number
  qty: number
}

export default function MenuClient({
  token,
  cafeName,
  tableLabel,
  upsellThreshold,
  categories,
  items,
  variants,
  addons,
}: {
  token: string
  cafeName: string
  tableLabel: string
  upsellThreshold: number
  categories: { id: string; name: string }[]
  items: PublicItem[]
  variants: Variant[]
  addons: Addon[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const [cart, setCart] = useState<Line[]>([])
  const [step, setStep] = useState<'menu' | 'cart' | 'done'>('menu')
  const [phone, setPhone] = useState('')
  const [placing, setPlacing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [placed, setPlaced] = useState<{ code: string; total: number } | null>(null)
  const [customizing, setCustomizing] = useState<PublicItem | null>(null)

  const upsellShown = useRef(false)
  const upsellTaken = useRef<string | null>(null)

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const variantsByItem = useMemo(() => {
    const m = new Map<string, Variant[]>()
    variants.forEach((v) => m.set(v.menu_item_id, [...(m.get(v.menu_item_id) ?? []), v]))
    return m
  }, [variants])
  const addonsByItem = useMemo(() => {
    const m = new Map<string, Addon[]>()
    addons.forEach((a) => m.set(a.menu_item_id, [...(m.get(a.menu_item_id) ?? []), a]))
    return m
  }, [addons])

  const hasOptions = (id: string) => variantsByItem.has(id) || addonsByItem.has(id)

  const cats = useMemo(() => {
    const withItems = categories.filter((c) => items.some((i) => i.category_id === c.id))
    const uncategorised = items.some((i) => !i.category_id)
    return uncategorised ? [...withItems, { id: '__none', name: 'Other' }] : withItems
  }, [categories, items])

  const subtotal = cart.reduce((s, l) => s + l.unitPrice * l.qty, 0)
  const count = cart.reduce((s, l) => s + l.qty, 0)

  const upsell = useMemo(() => {
    if (count === 0 || subtotal < upsellThreshold) return null
    if (cart.some((l) => byId.get(l.itemId)?.is_upsell)) return null
    const cand = items.filter((i) => i.is_upsell && !hasOptions(i.id))
    return cand.length ? cand.reduce((a, b) => (a.price <= b.price ? a : b)) : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, subtotal, upsellThreshold, cart, items, byId])
  if (upsell && step === 'cart') upsellShown.current = true

  function addLine(line: Line) {
    setCart((c) => {
      const found = c.find((l) => l.key === line.key)
      if (found) return c.map((l) => (l.key === line.key ? { ...l, qty: l.qty + line.qty } : l))
      return [...c, line]
    })
  }
  function changeQty(key: string, delta: number) {
    setCart((c) =>
      c
        .map((l) => (l.key === key ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0),
    )
  }

  function addPlain(item: PublicItem, isUpsell = false) {
    if (isUpsell) upsellTaken.current = item.id
    addLine({
      key: item.id,
      itemId: item.id,
      name: item.name,
      variantId: null,
      addonIds: [],
      modLabel: '',
      unitPrice: item.price,
      qty: 1,
    })
  }

  function confirmCustom(item: PublicItem, variantId: string | null, addonIds: string[]) {
    const v = variantId ? variantsByItem.get(item.id)?.find((x) => x.id === variantId) : null
    const chosen = (addonsByItem.get(item.id) ?? []).filter((a) => addonIds.includes(a.id))
    const unit = item.price + (v?.price_delta ?? 0) + chosen.reduce((s, a) => s + a.price, 0)
    const label = [v?.name, ...chosen.map((a) => a.name)].filter(Boolean).join(', ')
    addLine({
      key: `${item.id}|${variantId ?? ''}|${[...addonIds].sort().join(',')}`,
      itemId: item.id,
      name: item.name,
      variantId,
      addonIds,
      modLabel: label,
      unitPrice: unit,
      qty: 1,
    })
    setCustomizing(null)
  }

  async function place(method: 'upi' | 'counter') {
    setPlacing(true)
    setError(null)
    const { data, error } = await supabase.rpc('place_order', {
      p_token: token,
      p_items: cart.map((l) => ({
        item_id: l.itemId,
        qty: l.qty,
        variant_id: l.variantId,
        addon_ids: l.addonIds,
      })),
      p_phone: phone || null,
      p_payment_method: method,
      p_upsell_item_id: upsellTaken.current,
      p_upsell_shown: upsellShown.current,
    })
    setPlacing(false)
    if (error) return setError(error.message)
    const r = data as { short_code: string; total: number }
    setPlaced({ code: r.short_code, total: r.total })
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
          const catItems = items.filter((i) => (cat.id === '__none' ? !i.category_id : i.category_id === cat.id))
          if (!catItems.length) return null
          return (
            <section key={cat.id}>
              <h2 className="px-5 pt-6 pb-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">{cat.name}</h2>
              <ul>
                {catItems.map((item) => {
                  const plainQty = cart.find((l) => l.key === item.id)?.qty ?? 0
                  const opt = hasOptions(item.id)
                  return (
                    <li key={item.id} className="flex items-center justify-between gap-4 border-b border-border bg-surface px-5 py-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-foreground">{item.name}</p>
                          {item.is_bestseller && <span className="rounded bg-warning-subtle px-1.5 py-0.5 text-[11px] font-medium text-warning">Bestseller</span>}
                        </div>
                        {item.description && <p className="truncate text-[13px] text-muted-foreground">{item.description}</p>}
                        <p className="text-sm text-muted-foreground">₹{item.price}{opt ? '+' : ''}</p>
                      </div>
                      {opt || plainQty === 0 ? (
                        <button onClick={() => (opt ? setCustomizing(item) : addPlain(item))} className="shrink-0 rounded-[var(--radius)] border border-primary bg-primary-subtle px-5 py-2 text-sm font-medium text-primary">
                          Add
                        </button>
                      ) : (
                        <div className="flex shrink-0 items-center gap-3 rounded-[var(--radius)] border border-primary bg-primary-subtle px-2 py-1">
                          <button onClick={() => changeQty(item.id, -1)} aria-label={`Remove one ${item.name}`} className="px-2 text-lg text-primary">−</button>
                          <span className="w-4 text-center text-sm font-medium text-primary">{plainQty}</span>
                          <button onClick={() => addPlain(item)} aria-label={`Add one ${item.name}`} className="px-2 text-lg text-primary">+</button>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}

      {step === 'cart' && (
        <div className="p-5">
          <button onClick={() => setStep('menu')} className="mb-4 text-sm text-muted-foreground">← Add more items</button>
          <ul className="overflow-hidden rounded-xl border border-border bg-surface">
            {cart.map((l) => (
              <li key={l.key} className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 last:border-0">
                <div className="min-w-0">
                  <p className="truncate text-foreground">{l.name}</p>
                  {l.modLabel && <p className="truncate text-[12px] text-muted-foreground">{l.modLabel}</p>}
                  <p className="text-sm text-muted-foreground">₹{l.unitPrice} × {l.qty}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <button onClick={() => changeQty(l.key, -1)} aria-label="Remove one" className="px-2 text-lg text-muted-foreground">−</button>
                  <span className="w-4 text-center text-sm">{l.qty}</span>
                  <button onClick={() => changeQty(l.key, 1)} aria-label="Add one" className="px-2 text-lg text-muted-foreground">+</button>
                  <span className="w-14 text-right text-foreground">₹{l.unitPrice * l.qty}</span>
                </div>
              </li>
            ))}
          </ul>

          {upsell && (
            <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-primary bg-primary-subtle p-4">
              <div className="min-w-0">
                <p className="font-medium text-primary">{upsell.upsell_pitch ?? `Add ${upsell.name}`}</p>
                <p className="text-sm text-primary">{upsell.name} · ₹{upsell.price}</p>
              </div>
              <button onClick={() => addPlain(upsell, true)} className="shrink-0 rounded-[var(--radius)] bg-primary px-5 py-2 text-sm font-medium text-primary-foreground">Add</button>
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
            <button disabled={placing || count === 0} onClick={() => place('upi')} className="w-full rounded-[var(--radius)] bg-foreground py-4 font-medium text-background disabled:opacity-40">
              {placing ? 'Placing…' : `Pay ₹${subtotal} by UPI`}
            </button>
            <button disabled={placing || count === 0} onClick={() => place('counter')} className="w-full rounded-[var(--radius)] border border-border-strong bg-surface py-4 font-medium text-foreground disabled:opacity-40">
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

      {customizing && (
        <Customizer
          item={customizing}
          variants={variantsByItem.get(customizing.id) ?? []}
          addons={addonsByItem.get(customizing.id) ?? []}
          onCancel={() => setCustomizing(null)}
          onAdd={confirmCustom}
        />
      )}
    </main>
  )
}

function Customizer({
  item,
  variants,
  addons,
  onCancel,
  onAdd,
}: {
  item: PublicItem
  variants: Variant[]
  addons: Addon[]
  onCancel: () => void
  onAdd: (item: PublicItem, variantId: string | null, addonIds: string[]) => void
}) {
  const [variantId, setVariantId] = useState<string | null>(variants[0]?.id ?? null)
  const [addonIds, setAddonIds] = useState<string[]>([])

  const v = variants.find((x) => x.id === variantId)
  const chosen = addons.filter((a) => addonIds.includes(a.id))
  const price = item.price + (v?.price_delta ?? 0) + chosen.reduce((s, a) => s + a.price, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6">
      <div className="w-full max-w-md rounded-t-2xl bg-surface p-6 sm:rounded-2xl">
        <h2 className="text-lg font-semibold text-foreground">{item.name}</h2>

        {variants.length > 0 && (
          <div className="mt-4">
            <p className="text-[13px] font-medium text-foreground">Choose one</p>
            <div className="mt-2 space-y-2">
              {variants.map((vr) => (
                <label key={vr.id} className="flex items-center justify-between rounded-[var(--radius)] border border-border-strong px-3 py-2.5 text-sm text-foreground">
                  <span className="flex items-center gap-2">
                    <input type="radio" name="variant" checked={variantId === vr.id} onChange={() => setVariantId(vr.id)} />
                    {vr.name}
                  </span>
                  <span className="text-muted-foreground">₹{item.price + vr.price_delta}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {addons.length > 0 && (
          <div className="mt-4">
            <p className="text-[13px] font-medium text-foreground">Add-ons</p>
            <div className="mt-2 space-y-2">
              {addons.map((a) => (
                <label key={a.id} className="flex items-center justify-between rounded-[var(--radius)] border border-border-strong px-3 py-2.5 text-sm text-foreground">
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={addonIds.includes(a.id)}
                      onChange={(e) => setAddonIds((ids) => (e.target.checked ? [...ids, a.id] : ids.filter((x) => x !== a.id)))}
                    />
                    {a.name}
                  </span>
                  <span className="text-muted-foreground">+₹{a.price}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 flex gap-2">
          <button onClick={onCancel} className="flex-1 rounded-[var(--radius)] border border-border-strong py-3 text-sm font-medium text-foreground">Cancel</button>
          <button onClick={() => onAdd(item, variantId, addonIds)} className="flex-1 rounded-[var(--radius)] bg-primary py-3 text-sm font-medium text-primary-foreground">
            Add · ₹{price}
          </button>
        </div>
      </div>
    </div>
  )
}
