'use client'

// A waiter standing at a table needs to add a round of items without walking
// back to the counter POS, and without the POS's discount/customer-lookup/
// held-order machinery — none of that applies mid-service at a table. This is
// deliberately its own small component rather than the POS reused inline: the
// POS's cart panel assumes a checkout flow (payment method, discounts), which
// doesn't belong here. Both still route through the one canonical write path
// — staff_place_order — so pricing/variant/tenant rules are enforced exactly
// once, not reimplemented.
import { useMemo, useState } from 'react'
import { Minus, Plus, X } from 'lucide-react'

export type MenuCategory = { id: string; name: string; sort: number }
export type MenuItem = { id: string; name: string; price: number; category_id: string | null; available: boolean }
export type MenuVariant = { id: string; menu_item_id: string; name: string; price_delta: number }
export type MenuAddon = { id: string; menu_item_id: string; name: string; price: number }

type Line = { itemId: string; variantId: string | null; addonIds: string[]; qty: number; label: string }

export function QuickAddSheet({
  tableLabel,
  categories,
  items,
  variants,
  addons,
  submitting,
  error,
  onClose,
  onSubmit,
}: {
  tableLabel: string
  categories: MenuCategory[]
  items: MenuItem[]
  variants: MenuVariant[]
  addons: MenuAddon[]
  submitting: boolean
  error: string | null
  onClose: () => void
  onSubmit: (lines: { item_id: string; qty: number; variant_id: string | null; addon_ids: string[] }[]) => void
}) {
  const [activeCat, setActiveCat] = useState<string>('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [pickVariant, setPickVariant] = useState<string | null>(null)
  const [pickAddons, setPickAddons] = useState<string[]>([])
  const [cart, setCart] = useState<Line[]>([])

  const variantsByItem = useMemo(() => {
    const m = new Map<string, MenuVariant[]>()
    variants.forEach((v) => m.set(v.menu_item_id, [...(m.get(v.menu_item_id) ?? []), v]))
    return m
  }, [variants])
  const addonsByItem = useMemo(() => {
    const m = new Map<string, MenuAddon[]>()
    addons.forEach((a) => m.set(a.menu_item_id, [...(m.get(a.menu_item_id) ?? []), a]))
    return m
  }, [addons])

  const visible = items.filter((i) => i.available && (activeCat === 'all' || i.category_id === activeCat))
  const cartCount = cart.reduce((s, l) => s + l.qty, 0)

  function openItem(item: MenuItem) {
    const opts = variantsByItem.get(item.id) ?? []
    if (opts.length === 0 && !(addonsByItem.get(item.id)?.length)) {
      addLine(item, null, [])
      return
    }
    setExpanded(item.id)
    setPickVariant(opts[0]?.id ?? null)
    setPickAddons([])
  }

  function addLine(item: MenuItem, variantId: string | null, addonIds: string[]) {
    const variant = (variantsByItem.get(item.id) ?? []).find((v) => v.id === variantId)
    const chosen = (addonsByItem.get(item.id) ?? []).filter((a) => addonIds.includes(a.id))
    const label = [item.name, variant?.name, ...chosen.map((a) => a.name)].filter(Boolean).join(', ')
    setCart((prev) => {
      const key = `${item.id}|${variantId ?? ''}|${[...addonIds].sort().join(',')}`
      const existing = prev.find((l) => `${l.itemId}|${l.variantId ?? ''}|${[...l.addonIds].sort().join(',')}` === key)
      if (existing) return prev.map((l) => (l === existing ? { ...l, qty: l.qty + 1 } : l))
      return [...prev, { itemId: item.id, variantId, addonIds, qty: 1, label }]
    })
    setExpanded(null)
  }

  function changeQty(line: Line, delta: number) {
    setCart((prev) =>
      prev
        .map((l) => (l === line ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0),
    )
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-6" onClick={onClose}>
      <div
        className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-surface sm:max-h-[85dvh] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 className="text-base font-semibold text-foreground">Add to Table {tableLabel}</h3>
          <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>

        <div className="flex gap-2 overflow-x-auto border-b border-border px-5 py-3">
          <button
            onClick={() => setActiveCat('all')}
            className={`min-h-9 shrink-0 rounded-full border px-3 text-[13px] font-medium ${activeCat === 'all' ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-muted-foreground'}`}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveCat(c.id)}
              className={`min-h-9 shrink-0 rounded-full border px-3 text-[13px] font-medium ${activeCat === c.id ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-muted-foreground'}`}
            >
              {c.name}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          <ul className="divide-y divide-border">
            {visible.map((item) => (
              <li key={item.id} className="py-2.5">
                <button onClick={() => openItem(item)} className="flex w-full items-center justify-between gap-3 text-left">
                  <span className="text-sm text-foreground">{item.name}</span>
                  <span className="shrink-0 text-sm font-medium text-foreground">₹{item.price}</span>
                </button>

                {expanded === item.id && (
                  <div className="mt-2 rounded-[var(--radius)] border border-border bg-surface-subtle p-3">
                    {(variantsByItem.get(item.id) ?? []).length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {(variantsByItem.get(item.id) ?? []).map((v) => (
                          <button
                            key={v.id}
                            onClick={() => setPickVariant(v.id)}
                            className={`min-h-9 rounded-full border px-3 text-[12.5px] ${pickVariant === v.id ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-muted-foreground'}`}
                          >
                            {v.name}{v.price_delta > 0 ? ` +₹${v.price_delta}` : ''}
                          </button>
                        ))}
                      </div>
                    )}
                    {(addonsByItem.get(item.id) ?? []).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(addonsByItem.get(item.id) ?? []).map((a) => (
                          <button
                            key={a.id}
                            onClick={() => setPickAddons((prev) => (prev.includes(a.id) ? prev.filter((x) => x !== a.id) : [...prev, a.id]))}
                            className={`min-h-9 rounded-full border px-3 text-[12.5px] ${pickAddons.includes(a.id) ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-muted-foreground'}`}
                          >
                            {a.name}{a.price > 0 ? ` +₹${a.price}` : ''}
                          </button>
                        ))}
                      </div>
                    )}
                    <button
                      onClick={() => addLine(item, pickVariant, pickAddons)}
                      className="mt-3 min-h-10 w-full rounded-[var(--radius)] bg-primary text-[13px] font-medium text-primary-foreground"
                    >
                      Add
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>

        {cart.length > 0 && (
          <div className="max-h-40 overflow-y-auto border-t border-border px-5 py-3">
            {cart.map((l, i) => (
              <div key={i} className="flex items-center justify-between gap-2 py-1 text-[13px]">
                <span className="min-w-0 truncate text-foreground">{l.label}</span>
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => changeQty(l, -1)} aria-label="Fewer" className="grid h-8 w-8 place-items-center rounded-full border border-border-strong text-muted-foreground"><Minus size={13} /></button>
                  <span className="w-4 text-center text-foreground">{l.qty}</span>
                  <button onClick={() => changeQty(l, 1)} aria-label="More" className="grid h-8 w-8 place-items-center rounded-full border border-border-strong text-muted-foreground"><Plus size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        )}

        {error && <p className="mx-5 mb-2 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">{error}</p>}

        <div className="border-t border-border p-4">
          <button
            disabled={cart.length === 0 || submitting}
            onClick={() => onSubmit(cart.map((l) => ({ item_id: l.itemId, qty: l.qty, variant_id: l.variantId, addon_ids: l.addonIds })))}
            className="min-h-12 w-full rounded-[var(--radius)] bg-primary text-sm font-medium text-primary-foreground disabled:opacity-40"
          >
            {submitting ? 'Sending…' : cartCount > 0 ? `Send ${cartCount} item${cartCount === 1 ? '' : 's'} to kitchen` : 'Add items above'}
          </button>
        </div>
      </div>
    </div>
  )
}
