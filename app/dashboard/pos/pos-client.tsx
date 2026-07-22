'use client'

import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { CategoryTabs, type PosCategory } from '@/components/pos/category-tabs'
import { ProductCard, type PosItem } from '@/components/pos/product-card'
import { CartPanel, type CartLine, type PosTable } from '@/components/pos/cart-panel'
import type { PosVariant, PosAddon } from './page'

type FullItem = PosItem & { category_id: string | null }
type Line = CartLine & { itemId: string; variantId: string | null; addonIds: string[] }

export default function PosClient({
  cafeId,
  taxPercent,
  serviceChargePercent,
  categories,
  items,
  variants,
  addons,
  tables,
}: {
  cafeId: string
  taxPercent: number
  serviceChargePercent: number
  categories: PosCategory[]
  items: FullItem[]
  variants: PosVariant[]
  addons: PosAddon[]
  tables: PosTable[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const [activeCategory, setActiveCategory] = useState<string | 'all'>('all')
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<Line[]>([])
  const [orderType, setOrderType] = useState<'dine_in' | 'takeaway'>('dine_in')
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'counter'>('counter')
  const [customizing, setCustomizing] = useState<FullItem | null>(null)
  const [placing, setPlacing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<{ code: string; total: number; token: string } | null>(null)
  const [cartOpen, setCartOpen] = useState(false)

  const variantsByItem = useMemo(() => {
    const m = new Map<string, PosVariant[]>()
    variants.forEach((v) => m.set(v.menu_item_id, [...(m.get(v.menu_item_id) ?? []), v]))
    return m
  }, [variants])
  const addonsByItem = useMemo(() => {
    const m = new Map<string, PosAddon[]>()
    addons.forEach((a) => m.set(a.menu_item_id, [...(m.get(a.menu_item_id) ?? []), a]))
    return m
  }, [addons])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items
      .filter((i) => (activeCategory === 'all' ? true : i.category_id === activeCategory))
      .filter((i) => (q ? i.name.toLowerCase().includes(q) : true))
  }, [items, activeCategory, search])

  const qtyByItem = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of cart) m.set(l.itemId, (m.get(l.itemId) ?? 0) + l.qty)
    return m
  }, [cart])

  function addPlain(item: FullItem) {
    setCart((c) => {
      const found = c.find((l) => l.key === item.id)
      if (found) return c.map((l) => (l.key === item.id ? { ...l, qty: l.qty + 1 } : l))
      return [...c, { key: item.id, itemId: item.id, variantId: null, addonIds: [], name: item.name, modLabel: '', unitPrice: item.price, qty: 1 }]
    })
  }

  function confirmCustom(item: FullItem, variantId: string | null, addonIds: string[]) {
    const v = variantId ? variantsByItem.get(item.id)?.find((x) => x.id === variantId) : null
    const chosen = (addonsByItem.get(item.id) ?? []).filter((a) => addonIds.includes(a.id))
    const unit = item.price + (v?.price_delta ?? 0) + chosen.reduce((s, a) => s + a.price, 0)
    const label = [v?.name, ...chosen.map((a) => a.name)].filter(Boolean).join(', ')
    const key = `${item.id}|${variantId ?? ''}|${[...addonIds].sort().join(',')}`
    setCart((c) => {
      const found = c.find((l) => l.key === key)
      if (found) return c.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l))
      return [...c, { key, itemId: item.id, variantId, addonIds, name: item.name, modLabel: label, unitPrice: unit, qty: 1 }]
    })
    setCustomizing(null)
  }

  function changeQty(key: string, delta: number) {
    setCart((c) => c.map((l) => (l.key === key ? { ...l, qty: l.qty + delta } : l)).filter((l) => l.qty > 0))
  }
  function removeLine(key: string) {
    setCart((c) => c.filter((l) => l.key !== key))
  }

  async function placeOrder() {
    if (orderType === 'dine_in' && !selectedTableId) return
    setPlacing(true)
    setError(null)
    const { data, error } = await supabase.rpc('staff_place_order', {
      p_cafe_id: cafeId,
      p_items: cart.map((l) => ({ item_id: l.itemId, qty: l.qty, variant_id: l.variantId, addon_ids: l.addonIds })),
      p_order_type: orderType,
      p_table_id: orderType === 'dine_in' ? selectedTableId : null,
      p_payment_method: paymentMethod,
    })
    setPlacing(false)
    if (error) return setError(error.message)
    const r = data as { short_code: string; total: number; receipt_token: string }
    setSuccess({ code: r.short_code, total: r.total, token: r.receipt_token })
    setCart([])
    setCartOpen(false)
    setTimeout(() => setSuccess(null), 6000)
  }

  const selectedTable = tables.find((t) => t.id === selectedTableId) ?? null
  const cartCount = cart.reduce((s, l) => s + l.qty, 0)
  const cartTotal = cart.reduce((s, l) => s + l.unitPrice * l.qty, 0)

  const cartProps = {
    tableLabel: selectedTable?.label ?? null,
    orderType,
    onOrderType: setOrderType,
    tables,
    selectedTableId,
    onSelectTable: setSelectedTableId,
    lines: cart,
    onQty: changeQty,
    onRemove: removeLine,
    taxPercent,
    serviceChargePercent,
    paymentMethod,
    onPaymentMethod: setPaymentMethod,
    onPlaceOrder: placeOrder,
    placing,
    error,
  }

  return (
    <div className="flex w-full min-w-0 items-start">
      {/* Workspace — scrolls with the page, same as every other dashboard screen. */}
      <div className="min-w-0 flex-1">
        <div className="border-b border-border bg-surface px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search menu…"
                className="h-11 w-full rounded-[var(--radius)] border border-border-strong bg-surface-subtle pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground"
              />
            </div>
          </div>
          <div className="mt-3">
            <CategoryTabs categories={categories} activeId={activeCategory} onSelect={setActiveCategory} totalCount={items.length} />
          </div>
        </div>

        <div className="p-5 pb-24 lg:pb-5">
          {visible.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">No items match.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {visible.map((item) => (
                <ProductCard
                  key={item.id}
                  item={item}
                  qty={qtyByItem.get(item.id) ?? 0}
                  onAdd={() => (item.hasOptions ? setCustomizing(item) : addPlain(item))}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Cart — persistent right panel on desktop. Sticky + a direct dvh height
          (not a percentage of an ambiguous flex-parent chain) so it stays put
          while the product grid scrolls, regardless of how the shared
          dashboard layout resolves its own height on any given page. */}
      <div className="sticky top-0 hidden h-dvh w-[360px] shrink-0 border-l border-border lg:block">
        <CartPanel {...cartProps} />
      </div>

      {/* Cart — bottom bar + sheet on smaller screens */}
      {!cartOpen && cartCount > 0 && (
        <button
          onClick={() => setCartOpen(true)}
          className="fixed inset-x-4 bottom-4 z-30 flex min-h-12 items-center justify-between rounded-[var(--radius)] bg-primary px-5 text-primary-foreground shadow-[var(--shadow-lg)] lg:hidden"
        >
          <span className="text-[14px] font-medium">{cartCount} item{cartCount === 1 ? '' : 's'}</span>
          <span className="text-[15px] font-semibold">₹{cartTotal} · View cart</span>
        </button>
      )}
      {cartOpen && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/40 lg:hidden" onClick={() => setCartOpen(false)}>
          <div className="max-h-[90dvh] w-full overflow-hidden rounded-t-2xl bg-surface" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-sm font-medium text-foreground">Order</span>
              <button onClick={() => setCartOpen(false)} aria-label="Close" className="grid h-9 w-9 place-items-center text-muted-foreground">
                <X size={18} />
              </button>
            </div>
            <div className="max-h-[calc(90dvh-49px)] overflow-y-auto">
              <CartPanel {...cartProps} />
            </div>
          </div>
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

      {success && (
        <div className="fixed left-1/2 top-4 z-50 flex -translate-x-1/2 items-center gap-3 rounded-[var(--radius)] border border-success bg-primary-subtle px-4 py-3 shadow-[var(--shadow-lg)]">
          <span className="text-[13px] font-medium text-foreground">
            Order #{success.code} placed · ₹{success.total}
          </span>
          <a href={`/r/${success.token}`} target="_blank" className="text-[13px] font-semibold text-primary hover:underline">
            View bill →
          </a>
        </div>
      )}
    </div>
  )
}

function Customizer({
  item,
  variants,
  addons,
  onCancel,
  onAdd,
}: {
  item: FullItem
  variants: PosVariant[]
  addons: PosAddon[]
  onCancel: () => void
  onAdd: (item: FullItem, variantId: string | null, addonIds: string[]) => void
}) {
  const [variantId, setVariantId] = useState<string | null>(variants[0]?.id ?? null)
  const [addonIds, setAddonIds] = useState<string[]>([])
  const v = variants.find((x) => x.id === variantId)
  const chosen = addons.filter((a) => addonIds.includes(a.id))
  const price = item.price + (v?.price_delta ?? 0) + chosen.reduce((s, a) => s + a.price, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6">
      <div className="flex max-h-[90dvh] w-full max-w-md flex-col rounded-t-2xl bg-surface sm:max-h-[85dvh] sm:rounded-[var(--radius-lg)]">
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <h2 className="text-lg font-semibold text-foreground">{item.name}</h2>
          {variants.length > 0 && (
            <div className="mt-4">
              <p className="text-[13px] font-medium text-foreground">Choose one</p>
              <div className="mt-2 space-y-2">
                {variants.map((vr) => (
                  <label key={vr.id} className="flex min-h-11 items-center justify-between rounded-[var(--radius)] border border-border-strong px-3 text-sm text-foreground">
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
                  <label key={a.id} className="flex min-h-11 items-center justify-between rounded-[var(--radius)] border border-border-strong px-3 text-sm text-foreground">
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
        </div>
        <div className="flex shrink-0 gap-2 border-t border-border p-6">
          <button onClick={onCancel} className="min-h-11 flex-1 rounded-[var(--radius)] border border-border-strong text-sm font-medium text-foreground">Cancel</button>
          <button onClick={() => onAdd(item, variantId, addonIds)} className="min-h-11 flex-1 rounded-[var(--radius)] bg-primary text-sm font-medium text-primary-foreground">
            Add · ₹{price}
          </button>
        </div>
      </div>
    </div>
  )
}
