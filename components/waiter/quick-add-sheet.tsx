'use client'

// A waiter standing at a table needs to add a round of items without walking
// back to the counter POS, and without the POS's discount/customer-lookup/
// held-order machinery — none of that applies mid-service at a table. This is
// deliberately its own small component rather than the POS reused inline: the
// POS's cart panel assumes a checkout flow (payment method, discounts), which
// doesn't belong here. Both still route through the one canonical write path
// — staff_place_order / append_order_items — so pricing/variant/tenant rules
// are enforced exactly once, not reimplemented.
import { useMemo, useState } from 'react'
import { Minus, Plus, Search, X } from 'lucide-react'

export type MenuCategory = { id: string; name: string; sort: number }
export type MenuItem = { id: string; name: string; price: number; category_id: string | null; available: boolean }
export type MenuVariant = { id: string; menu_item_id: string; name: string; price_delta: number }
export type MenuAddon = { id: string; menu_item_id: string; name: string; price: number }

type Line = { itemId: string; variantId: string | null; addonIds: string[]; qty: number; label: string; unitPrice: number }

export function QuickAddSheet({
  tableLabel,
  subtitle,
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
  /** Whether this round is joining the table's existing bill or starting a
   *  new one (migration 0218) — the exact distinction staff had no way to
   *  see before, which is what prompted this feature. */
  subtitle?: string
  categories: MenuCategory[]
  items: MenuItem[]
  variants: MenuVariant[]
  addons: MenuAddon[]
  submitting: boolean
  error: string | null
  onClose: () => void
  onSubmit: (lines: { item_id: string; qty: number; variant_id: string | null; addon_ids: string[] }[]) => void
}) {
  const [search, setSearch] = useState('')
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

  const query = search.trim().toLowerCase()
  const visible = items.filter(
    (i) => i.available && (activeCat === 'all' || i.category_id === activeCat) && (query === '' || i.name.toLowerCase().includes(query)),
  )
  const cartCount = cart.reduce((s, l) => s + l.qty, 0)
  const cartTotal = cart.reduce((s, l) => s + l.unitPrice * l.qty, 0)
  // So an item already sitting in the cart shows a quiet "2 added" hint in
  // the list, instead of staff having to scroll down to check.
  const qtyInCartByItem = useMemo(() => {
    const m = new Map<string, number>()
    cart.forEach((l) => m.set(l.itemId, (m.get(l.itemId) ?? 0) + l.qty))
    return m
  }, [cart])

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
    const unitPrice = item.price + (variant?.price_delta ?? 0) + chosen.reduce((s, a) => s + a.price, 0)
    setCart((prev) => {
      const key = `${item.id}|${variantId ?? ''}|${[...addonIds].sort().join(',')}`
      const existing = prev.find((l) => `${l.itemId}|${l.variantId ?? ''}|${[...l.addonIds].sort().join(',')}` === key)
      if (existing) return prev.map((l) => (l === existing ? { ...l, qty: l.qty + 1 } : l))
      return [...prev, { itemId: item.id, variantId, addonIds, qty: 1, label, unitPrice }]
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
        className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-surface shadow-xl sm:max-h-[85dvh] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-foreground">Add to Table {tableLabel}</h3>
            {subtitle && <p className="text-[12.5px] text-muted-foreground">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-surface-subtle hover:text-foreground"><X size={18} /></button>
        </div>

        <div className="border-b border-border px-5 py-3">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search the menu…"
              className="h-11 w-full rounded-[var(--radius)] border border-border-strong bg-surface-subtle pl-9 pr-9 text-[16px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
            {search !== '' && (
              <button
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-surface hover:text-foreground"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {search === '' && (
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
        )}

        <div className="flex-1 overflow-y-auto px-5 py-2">
          {visible.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-muted-foreground">No items match &quot;{search}&quot;.</p>
          ) : (
            <ul className="divide-y divide-border">
              {visible.map((item) => {
                const inCart = qtyInCartByItem.get(item.id) ?? 0
                return (
                  <li key={item.id} className="py-2.5">
                    <button onClick={() => openItem(item)} className="flex w-full items-center justify-between gap-3 text-left">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm text-foreground">{item.name}</span>
                        {inCart > 0 && (
                          <span className="shrink-0 rounded-full bg-primary-subtle px-2 py-0.5 text-[11px] font-medium text-primary">{inCart} added</span>
                        )}
                      </span>
                      <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">₹{item.price}</span>
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
                )
              })}
            </ul>
          )}
        </div>

        {/* Always present — even empty — so it's never a mystery where added
            items go. Reported live: staff couldn't tell this section existed
            because it used to only render once the cart had something in it. */}
        <div className="border-t border-border bg-surface-subtle">
          {cart.length === 0 ? (
            <p className="px-5 py-3 text-[12.5px] text-muted-foreground">No items added yet — tap a menu item above.</p>
          ) : (
            <>
              <div className="max-h-36 overflow-y-auto px-5 py-2">
                {cart.map((l, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 py-1.5 text-[13px]">
                    <span className="min-w-0 truncate text-foreground">{l.label}</span>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="w-12 text-right tabular-nums text-muted-foreground">₹{l.unitPrice * l.qty}</span>
                      <div className="flex items-center gap-2">
                        <button onClick={() => changeQty(l, -1)} aria-label="Fewer" className="grid h-8 w-8 place-items-center rounded-full border border-border-strong bg-surface text-muted-foreground"><Minus size={13} /></button>
                        <span className="w-4 text-center text-foreground">{l.qty}</span>
                        <button onClick={() => changeQty(l, 1)} aria-label="More" className="grid h-8 w-8 place-items-center rounded-full border border-border-strong bg-surface text-muted-foreground"><Plus size={13} /></button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between border-t border-border px-5 py-2 text-[13px] font-semibold text-foreground">
                <span>{cartCount} item{cartCount === 1 ? '' : 's'}</span>
                <span className="tabular-nums">₹{cartTotal}</span>
              </div>
            </>
          )}
        </div>

        {error && <p className="mx-5 mt-3 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">{error}</p>}

        <div className="border-t border-border p-4">
          <button
            disabled={cart.length === 0 || submitting}
            onClick={() => onSubmit(cart.map((l) => ({ item_id: l.itemId, qty: l.qty, variant_id: l.variantId, addon_ids: l.addonIds })))}
            className="min-h-12 w-full rounded-[var(--radius)] bg-primary text-sm font-medium text-primary-foreground disabled:opacity-40"
          >
            {submitting ? 'Sending…' : cartCount > 0 ? `Send ${cartCount} item${cartCount === 1 ? '' : 's'} to kitchen — ₹${cartTotal}` : 'Add items above'}
          </button>
        </div>
      </div>
    </div>
  )
}
