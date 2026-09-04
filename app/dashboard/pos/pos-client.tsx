'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, TrendingUp, ClipboardList, Users, ChefHat, ArrowRight } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import { CategoryTabs, type PosCategory } from '@/components/pos/category-tabs'
import { categoryDisplayName } from '@/lib/category-icons'
import { ProductCard, type PosItem } from '@/components/pos/product-card'
import { CartPanel, type CartLine, type PosTable, type PosArea, type CustomerLookup, type Tender } from '@/components/pos/cart-panel'
import { TableSelector, type LiveTable } from '@/components/pos/table-selector'
import { fetchRecommendations, logRecommendationEvent, type Recommendation } from '@/lib/recommend'
import { HeldOrdersDrawer, type HeldOrder } from '@/components/pos/held-orders-drawer'
import { ComboPicker } from '@/components/pos/combo-picker'
import { Customizer } from '@/components/pos/customizer'
import type { HeldPrize } from '@/components/pos/spin-claim'
import { businessDayStartISO, businessDaysAgoStartISO, businessWeekday } from '@/lib/datetime'
import { effectivePrice, isOfferActiveToday } from '@/lib/offers'
import { comboCartKey, comboSelectionLabel, slotsOf, type Combo, type ComboSlot, type ComboSelection } from '@/lib/combos'
import type { PosVariant, PosAddon } from './page'

// Same freshness window as the customer QR menu (menu-client.tsx) — one
// definition of "new" would be nicer as a shared constant, but duplicating a
// single number here is simpler than adding a cross-surface import for it.
const NEW_ITEM_DAYS = 14

/**
 * Turn a spin-prize rejection into something a counter staffer can act on.
 *
 * redeem_spin_prize runs inside staff_place_order's transaction, so when it
 * raises, the whole order fails and its message lands in the order-placement
 * error slot — nowhere near the spin code box, and phrased for a database.
 * "that prize has already been claimed" as an ORDER failure reads like the
 * till is broken, when the fix is simply to take the prize off the bill.
 *
 * The prize is on the bill either way, so naming the remedy is the whole job.
 */
function spinFailureHint(message: string): string {
  const spin = /prize|spin/i.test(message)
  if (!spin) return message
  return `${message}. Remove the spin code from this bill and place the order again.`
}

type FullItem = PosItem & { category_id: string | null }
type Line = CartLine & {
  itemId: string
  variantId: string | null
  addonIds: string[]
  pointsCost?: number
  // Combo lines carry the whole bundle: one cart line, expanded server-side
  // into real component rows by expand_combo_line.
  comboId?: string | null
  selections?: ComboSelection[]
}
type HeldRow = {
  id: string
  order_type: 'dine_in' | 'takeaway'
  table_id: string | null
  customer_phone: string | null
  customer_name: string | null
  cart: Line[]
  created_at: string
}

export default function PosClient({
  cafeId,
  role,
  timezone,
  taxPercent,
  serviceChargePercent,
  dineIn,
  takeaway,
  categories,
  items,
  variants,
  addons,
  tables,
  areas,
  loyaltyEnabled,
  spinEnabled,
  couponsEnabled,
  gstRegistered,
  taxInclusive,
  itemTaxRates,
  rewards,
  combos,
  comboSlots,
}: {
  cafeId: string
  role: string
  timezone: string
  taxPercent: number
  serviceChargePercent: number
  dineIn: boolean
  takeaway: boolean
  categories: PosCategory[]
  items: FullItem[]
  variants: PosVariant[]
  addons: PosAddon[]
  tables: PosTable[]
  areas: PosArea[]
  loyaltyEnabled: boolean
  spinEnabled: boolean
  couponsEnabled: boolean
  gstRegistered: boolean
  taxInclusive: boolean
  itemTaxRates: Record<string, number | null>
  rewards: { id: string; name: string; points_cost: number; menu_item_id: string | null; variant_id: string | null }[]
  combos: Combo[]
  comboSlots: ComboSlot[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const confirm = useConfirm()
  const { toast } = useToast()

  const [activeCategory, setActiveCategory] = useState<string | 'all'>('all')
  const [search, setSearch] = useState('')
  const [sortMode, setSortMode] = useState<'popular' | 'price_low' | 'price_high' | 'name'>('popular')
  // Local copy so a category added from the rail (owner/manager only, same
  // plain insert menu-manager.tsx already does) appears immediately without
  // a full page reload. Server-truth on every subsequent page load either
  // way — this is just an optimistic append.
  const [categoryList, setCategoryList] = useState<PosCategory[]>(categories)
  const [addingCategory, setAddingCategory] = useState(false)
  const canManageCategories = role === 'owner' || role === 'manager'
  async function addCategory(name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    setAddingCategory(true)
    const { data, error } = await supabase
      .from('menu_categories')
      .insert({ cafe_id: cafeId, name: trimmed, sort: categoryList.length })
      .select('id, name')
      .single()
    setAddingCategory(false)
    if (error) return toast(error.message, 'error')
    setCategoryList((cs) => [...cs, { id: data.id, name: data.name, count: 0 }])
  }
  const [cart, setCart] = useState<Line[]>([])
  // Respect the café's enabled order types. If both are off (shouldn't happen)
  // fall back to dine-in so the POS still renders; the server trigger (0051) is
  // the real gate regardless of what the UI offers.
  const bothEnabled = dineIn && takeaway
  const [orderType, setOrderType] = useState<'dine_in' | 'takeaway'>(takeaway && !dineIn ? 'takeaway' : 'dine_in')
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null)
  // Resolved reactively below (order_appendable, migration 0218) — set only
  // when the selected table has exactly one open order and it's still
  // eligible to grow. placeOrder() uses this to route to append_order_items
  // instead of always opening a second bill on the same table, which is what
  // this screen did unconditionally until now.
  const [appendTargetOrderId, setAppendTargetOrderId] = useState<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [tender, setTender] = useState<Tender>('cash')
  const [pendingReason, setPendingReason] = useState('')
  const [customizing, setCustomizing] = useState<FullItem | null>(null)
  const [placing, setPlacing] = useState(false)
  // Stable per-attempt key so a network retry can never bill the same order
  // twice — see migration 0056. Cleared once an order actually succeeds.
  const requestId = useRef<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<{ code: string; total: number; token: string; paid: boolean; appended: boolean } | null>(null)
  const [cartOpen, setCartOpen] = useState(false)

  const [tableSelectorOpen, setTableSelectorOpen] = useState(false)
  // Seed from the canonical layout (area/position/shape); status fills on poll.
  const seedLive = (t: PosTable): LiveTable => ({
    id: t.id, label: t.label, status: t.occupied ? 'occupied' : 'available', sessionId: null,
    orderId: null, orderCount: 0,
    bill: 0, itemCount: 0, items: [],
    areaId: t.area_id, capacity: t.capacity,
    paid: 0, due: 0, payState: null, billRequested: false, ready: false, waiterCalled: false, mins: null,
  })
  const [liveTables, setLiveTables] = useState<LiveTable[]>(() => tables.map(seedLive))

  const [customerPhone, setCustomerPhone] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerLookup, setCustomerLookup] = useState<CustomerLookup | null>(null)
  const [lookingUpCustomer, setLookingUpCustomer] = useState(false)

  const [discountType, setDiscountType] = useState<'percent' | 'flat' | null>(null)
  const [discountValue, setDiscountValue] = useState('')

  const [couponCode, setCouponCode] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; discount: number; name: string | null } | null>(null)
  // Attached, not yet spent — staff_place_order redeems it in the same
  // transaction as the order, so nothing is burned until a bill exists.
  const [spinPrize, setSpinPrize] = useState<HeldPrize | null>(null)
  const [couponChecking, setCouponChecking] = useState(false)
  const [couponError, setCouponError] = useState<string | null>(null)
  const [applicableCoupons, setApplicableCoupons] = useState<
    { code: string; name: string | null; kind: string; value: number; discount: number }[] | null
  >(null)
  const [couponSuggestionsLoading, setCouponSuggestionsLoading] = useState(false)

  // Survives navigating away mid-order (e.g. to Bills) and back — the POS
  // page fully unmounts on route change, so without this the in-progress
  // cart was silently lost. sessionStorage (not localStorage): a draft
  // shouldn't outlive the browser tab into a later shift on a shared
  // terminal. Cleared automatically once the cart is actually empty again
  // (order placed, held, or manually cleared) — see the effect below.
  const draftKey = `pos-draft:${cafeId}`
  const skipNextDraftWrite = useRef(true)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(draftKey)
      if (!raw) return
      const d = JSON.parse(raw) as {
        cart?: Line[]; customerPhone?: string; customerName?: string
        orderType?: 'dine_in' | 'takeaway'; selectedTableId?: string | null
        tender?: Tender; pendingReason?: string
        discountType?: 'percent' | 'flat' | null; discountValue?: string
        couponCode?: string; appliedCoupon?: { code: string; discount: number; name: string | null } | null
        spinPrize?: HeldPrize | null
      }
      // One-time hydration from storage on mount, not an ongoing sync loop —
      // the pattern this lint rule warns about doesn't apply here.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (d.cart?.length) setCart(d.cart)
      if (d.customerPhone) setCustomerPhone(d.customerPhone)
      if (d.customerName) setCustomerName(d.customerName)
      if (d.orderType) setOrderType(d.orderType)
      if (d.selectedTableId) setSelectedTableId(d.selectedTableId)
      if (d.tender) setTender(d.tender)
      if (d.pendingReason) setPendingReason(d.pendingReason)
      if (d.discountType) setDiscountType(d.discountType)
      if (d.discountValue) setDiscountValue(d.discountValue)
      if (d.couponCode) setCouponCode(d.couponCode)
      if (d.appliedCoupon) setAppliedCoupon(d.appliedCoupon)
      if (d.spinPrize) setSpinPrize(d.spinPrize)
    } catch {
      // Corrupt or inaccessible storage — start with a normal empty cart.
    }
    // Deliberately once per mount only (draftKey is stable for the life of
    // this page instance).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // The mount-time render still holds the pre-hydration (empty) state by
    // the time this runs in the same commit — writing here would erase the
    // draft the effect above just read. Skip exactly that one first pass.
    if (skipNextDraftWrite.current) {
      skipNextDraftWrite.current = false
      return
    }
    try {
      const isEmpty = cart.length === 0 && !customerPhone && !customerName && !discountType && !couponCode && !appliedCoupon && !spinPrize
      if (isEmpty) {
        sessionStorage.removeItem(draftKey)
      } else {
        sessionStorage.setItem(draftKey, JSON.stringify({
          cart, customerPhone, customerName, orderType, selectedTableId,
          tender, pendingReason, discountType, discountValue, couponCode, appliedCoupon, spinPrize,
        }))
      }
    } catch {
      // Storage unavailable (private browsing, quota) — draft just won't persist.
    }
  }, [cart, customerPhone, customerName, orderType, selectedTableId, tender, pendingReason, discountType, discountValue, couponCode, appliedCoupon, spinPrize, draftKey])

  const [combobuilding, setCombobuilding] = useState<Combo | null>(null)
  const [heldRows, setHeldRows] = useState<HeldRow[]>([])
  const [heldOrdersOpen, setHeldOrdersOpen] = useState(false)
  const [holding, setHolding] = useState(false)

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

  // "New Arrivals" — same freshness heuristic as the customer QR menu (real
  // created_at data, not fabricated). Suppressed if it would cover most of an
  // young/small menu, same guard as the QR side.
  const newItemIds = useMemo(() => {
    const cutoff = Date.now() - NEW_ITEM_DAYS * 86400000
    const fresh = items.filter((i) => new Date(i.created_at).getTime() > cutoff)
    if (items.length === 0 || fresh.length / items.length > 0.3) return new Set<string>()
    return new Set(fresh.map((i) => i.id))
  }, [items])
  const bestsellerCount = useMemo(() => items.filter((i) => i.is_bestseller).length, [items])

  // Today's Offer — café-local day of week, matching what place_order/
  // staff_place_order enforce server-side (see lib/offers.ts).
  const todayWeekday = useMemo(() => businessWeekday(timezone), [timezone])
  const offerActiveIds = useMemo(
    () => new Set(items.filter((i) => isOfferActiveToday(i, todayWeekday)).map((i) => i.id)),
    [items, todayWeekday],
  )

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = items
      .filter((i) => {
        if (activeCategory === 'all') return true
        if (activeCategory === '__bestsellers') return i.is_bestseller
        if (activeCategory === '__new') return newItemIds.has(i.id)
        return i.category_id === activeCategory
      })
      .filter((i) => (q ? i.name.toLowerCase().includes(q) : true))
    // Display order only — never touches price/tax/business logic. "Popular"
    // is a stable sort (bestsellers first, otherwise the café's own menu
    // order), so it's the same ordering as before this control existed.
    const sorted = [...filtered]
    if (sortMode === 'price_low') sorted.sort((a, b) => a.price - b.price)
    else if (sortMode === 'price_high') sorted.sort((a, b) => b.price - a.price)
    else if (sortMode === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name))
    else sorted.sort((a, b) => Number(b.is_bestseller) - Number(a.is_bestseller))
    return sorted
  }, [items, activeCategory, search, newItemIds, sortMode])

  const qtyByItem = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of cart) if (l.itemId) m.set(l.itemId, (m.get(l.itemId) ?? 0) + l.qty)
    return m
  }, [cart])

  // ── Smart cross-sell (deterministic, server-side, fail-safe) ─────────────
  const [recs, setRecs] = useState<Recommendation[]>([])
  // Combo lines carry no single itemId — exclude them rather than sending an
  // empty id into the recommendation lookup.
  const cartItemIds = useMemo(() => [...new Set(cart.map((l) => l.itemId).filter(Boolean))], [cart])
  useEffect(() => {
    let cancelled = false
    const t = setTimeout(async () => {
      const list = cartItemIds.length === 0 ? [] : await fetchRecommendations(supabase, cafeId, cartItemIds, 4)
      if (cancelled) return
      setRecs(list)
      for (const r of list) logRecommendationEvent(supabase, cafeId, r.id, 'impression', 'pos')
    }, cartItemIds.length === 0 ? 0 : 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [cartItemIds, supabase, cafeId])

  function addRecommendation(rec: Recommendation) {
    logRecommendationEvent(supabase, cafeId, rec.id, 'add', 'pos')
    const full = items.find((i) => i.id === rec.id)
    if (full?.hasOptions) return setCustomizing(full)
    if (full) return addPlain(full)
    // Fallback: add as a plain line from the recommendation payload.
    setCart((c) => {
      const found = c.find((l) => l.key === rec.id)
      if (found) return c.map((l) => (l.key === rec.id ? { ...l, qty: l.qty + 1 } : l))
      return [...c, { key: rec.id, itemId: rec.id, variantId: null, addonIds: [], name: rec.name, modLabel: '', unitPrice: rec.price, qty: 1 }]
    })
  }

  // useCallback (not a plain function) so its identity only changes with
  // todayWeekday — handleAddItem below depends on it staying stable across
  // the 5s/20s polling re-renders.
  const addPlain = useCallback((item: FullItem) => {
    const unit = effectivePrice(item, todayWeekday)
    setCart((c) => {
      const found = c.find((l) => l.key === item.id)
      if (found) return c.map((l) => (l.key === item.id ? { ...l, qty: l.qty + 1 } : l))
      return [...c, {
        key: item.id, itemId: item.id, variantId: null, addonIds: [], name: item.name, modLabel: '',
        unitPrice: unit, originalUnitPrice: unit !== item.price ? item.price : undefined, qty: 1,
      }]
    })
  }, [todayWeekday])

  // Stable reference passed to every ProductCard as onAdd — looking the item
  // up by id here (instead of building a per-item closure at the call site)
  // means the same function identity survives the 5s table-status poll and
  // 20s stats poll, so React.memo on ProductCard can actually skip
  // re-rendering cards whose own data hasn't changed.
  const handleAddItem = useCallback((itemId: string) => {
    const item = items.find((i) => i.id === itemId)
    if (!item) return
    if (item.hasOptions) setCustomizing(item)
    else addPlain(item)
  }, [items, addPlain])

  // A combo is one cart line carrying its whole configuration; the server
  // expands it into real component rows and prices the bundle itself.
  function addCombo(combo: Combo, selections: ComboSelection[]) {
    const key = comboCartKey(combo.id, selections)
    const label = comboSelectionLabel(slotsOf(comboSlots, combo.id), selections, (itemId, variantId) => {
      const name = items.find((i) => i.id === itemId)?.name ?? 'Item'
      const v = variantId ? variantsByItem.get(itemId)?.find((x) => x.id === variantId)?.name : null
      return v ? `${name} (${v})` : name
    })
    setCart((c) => {
      const found = c.find((l) => l.key === key)
      if (found) return c.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l))
      return [
        ...c,
        {
          key,
          itemId: '',
          variantId: null,
          addonIds: [],
          name: combo.name,
          modLabel: label,
          unitPrice: combo.price,
          qty: 1,
          comboId: combo.id,
          selections,
        },
      ]
    })
    setCombobuilding(null)
  }

  function confirmCustom(item: FullItem, variantId: string | null, addonIds: string[]) {
    const v = variantId ? variantsByItem.get(item.id)?.find((x) => x.id === variantId) : null
    const chosen = (addonsByItem.get(item.id) ?? []).filter((a) => addonIds.includes(a.id))
    const deltas = (v?.price_delta ?? 0) + chosen.reduce((s, a) => s + a.price, 0)
    const unit = effectivePrice(item, todayWeekday) + deltas
    // Only the base item is ever discounted (offer_price lives on menu_items,
    // not variants/add-ons) — the original comparison keeps the same deltas.
    const originalUnit = item.price + deltas
    const label = [v?.name, ...chosen.map((a) => a.name)].filter(Boolean).join(', ')
    const key = `${item.id}|${variantId ?? ''}|${[...addonIds].sort().join(',')}`
    setCart((c) => {
      const found = c.find((l) => l.key === key)
      if (found) return c.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l))
      return [...c, {
        key, itemId: item.id, variantId, addonIds, name: item.name, modLabel: label,
        unitPrice: unit, originalUnitPrice: unit !== originalUnit ? originalUnit : undefined, qty: 1,
      }]
    })
    setCustomizing(null)
  }

  function changeQty(key: string, delta: number) {
    setCart((c) => c.map((l) => (l.key === key ? { ...l, qty: l.qty + delta } : l)).filter((l) => l.qty > 0))
  }
  function removeLine(key: string) {
    setCart((c) => c.filter((l) => l.key !== key))
  }
  function noteLine(key: string, note: string) {
    setCart((c) => c.map((l) => (l.key === key ? { ...l, note } : l)))
  }

  // ── Live table status + running bill + payment state, for the selector ──────
  // Reads the SAME canonical tables/floor_areas + ledger the Live Tables screen
  // uses (no separate POS table source), so status is consistent everywhere.
  const pollTables = useCallback(async () => {
    const [{ data: tbls }, { data: sess }, { data: unread }] = await Promise.all([
      supabase.from('cafe_tables').select('id, label, status, area_id, capacity').eq('cafe_id', cafeId).eq('archived', false),
      supabase.from('table_sessions').select('id, table_id, status, started_at').eq('cafe_id', cafeId).in('status', ['active', 'bill_requested']),
      supabase.from('notifications').select('table_id').eq('cafe_id', cafeId).eq('type', 'call_waiter').eq('read', false),
    ])
    const sessions = (sess ?? []) as { id: string; table_id: string; status: string; started_at: string }[]
    const sessionIds = sessions.map((s) => s.id)

    let orders: { id: string; session_id: string; total: number; status: string }[] = []
    let orderItems: { order_id: string; name: string; qty: number }[] = []
    let payments: { session_id: string | null; order_id: string | null; amount: number }[] = []
    if (sessionIds.length) {
      const { data: ords } = await supabase
        .from('orders')
        .select('id, session_id, total, status')
        .eq('cafe_id', cafeId)
        .in('session_id', sessionIds)
        .neq('status', 'cancelled')
      orders = (ords ?? []) as typeof orders
      const orderIds = orders.map((o) => o.id)
      if (orderIds.length) {
        const payFilter = `session_id.in.(${sessionIds.join(',')}),order_id.in.(${orderIds.join(',')})`
        const [{ data: its }, { data: pays }] = await Promise.all([
          supabase.from('order_items').select('order_id, name, qty').in('order_id', orderIds),
          supabase.from('payments').select('session_id, order_id, amount').or(payFilter),
        ])
        orderItems = (its ?? []) as typeof orderItems
        payments = (pays ?? []) as typeof payments
      }
    }

    const orderToSession = new Map(orders.map((o) => [o.id, o.session_id]))
    const sessionByTable = new Map(sessions.map((s) => [s.table_id, s]))
    const ordersBySession = new Map<string, typeof orders>()
    for (const o of orders) ordersBySession.set(o.session_id, [...(ordersBySession.get(o.session_id) ?? []), o])
    const itemsByOrder = new Map<string, typeof orderItems>()
    for (const i of orderItems) itemsByOrder.set(i.order_id, [...(itemsByOrder.get(i.order_id) ?? []), i])
    const paidBySession = new Map<string, number>()
    for (const p of payments) {
      const sid = p.session_id ?? (p.order_id ? orderToSession.get(p.order_id) : undefined)
      if (sid) paidBySession.set(sid, (paidBySession.get(sid) ?? 0) + p.amount)
    }
    const attention = new Set((unread ?? []).map((n) => n.table_id).filter(Boolean) as string[])

    const next: LiveTable[] = (tbls ?? []).map((t) => {
      const s = sessionByTable.get(t.id)
      const ords = s ? (ordersBySession.get(s.id) ?? []) : []
      const bill = ords.reduce((sum, o) => sum + o.total, 0)
      const its = ords.flatMap((o) => itemsByOrder.get(o.id) ?? [])
      const itemCount = its.reduce((sum, i) => sum + i.qty, 0)
      const paid = s ? Math.min(bill, paidBySession.get(s.id) ?? 0) : 0
      const due = Math.max(0, bill - paid)
      const payState: LiveTable['payState'] = !s ? null : bill > 0 && paid >= bill ? 'paid' : paid > 0 ? 'partial' : 'unpaid'
      return {
        id: t.id,
        label: t.label,
        status: t.status as LiveTable['status'],
        sessionId: s?.id ?? null,
        orderId: ords.length === 1 ? ords[0].id : null,
        orderCount: ords.length,
        bill,
        itemCount,
        items: its.map((i) => ({ name: i.name, qty: i.qty })),
        areaId: t.area_id ?? null,
        capacity: t.capacity ?? null,
        paid,
        due,
        payState,
        billRequested: s?.status === 'bill_requested',
        ready: ords.some((o) => o.status === 'ready'),
        waiterCalled: attention.has(t.id),
        mins: s ? Math.floor((Date.now() - new Date(s.started_at).getTime()) / 60000) : null,
      }
    })
    setLiveTables(next)
  }, [supabase, cafeId])

  useEffect(() => {
    void pollTables()
    const p = setInterval(pollTables, 5000)
    return () => clearInterval(p)
  }, [pollTables])

  // ── Bottom live strip — real numbers, lighter poll than the table grid.
  // Never steals space from ordering: collapsed entirely below lg (spec §"bottom
  // live strip"). A failed fetch just leaves the strip showing its last value.
  const [stats, setStats] = useState<{
    collected: number; orders: number; aov: number; preparing: number; ready: number
    collectedChangePct: number | null; ordersChangePct: number | null; aovChangePct: number | null
  } | null>(null)
  // null (not 0%) when there's no prior-day baseline to compare against — a
  // café's first-ever day, or a quiet yesterday, would otherwise show a
  // meaningless/misleading "+100%" or divide-by-zero.
  const pctChange = (curr: number, prev: number) => (prev === 0 ? null : Math.round(((curr - prev) / prev) * 100))
  const pollStats = useCallback(async () => {
    const dayStart = businessDayStartISO(timezone)
    const yesterdayStart = businessDaysAgoStartISO(1, timezone)
    const [{ data: ords }, { data: yOrds }, { data: kitchen }] = await Promise.all([
      supabase.from('orders').select('total').eq('cafe_id', cafeId).neq('status', 'cancelled').gte('created_at', dayStart),
      supabase.from('orders').select('total').eq('cafe_id', cafeId).neq('status', 'cancelled').gte('created_at', yesterdayStart).lt('created_at', dayStart),
      supabase.from('orders').select('status').eq('cafe_id', cafeId).in('status', ['preparing', 'ready']),
    ])
    const rows = ords ?? []
    const collected = rows.reduce((s, o) => s + (o.total ?? 0), 0)
    const orderCount = rows.length
    const aov = orderCount ? Math.round(collected / orderCount) : 0

    const yRows = yOrds ?? []
    const yCollected = yRows.reduce((s, o) => s + (o.total ?? 0), 0)
    const yOrderCount = yRows.length
    const yAov = yOrderCount ? Math.round(yCollected / yOrderCount) : 0

    setStats({
      collected,
      orders: orderCount,
      aov,
      preparing: (kitchen ?? []).filter((o) => o.status === 'preparing').length,
      ready: (kitchen ?? []).filter((o) => o.status === 'ready').length,
      collectedChangePct: pctChange(collected, yCollected),
      ordersChangePct: pctChange(orderCount, yOrderCount),
      aovChangePct: pctChange(aov, yAov),
    })
  }, [supabase, cafeId, timezone])

  useEffect(() => {
    void pollStats()
    const p = setInterval(pollStats, 20000)
    return () => clearInterval(p)
  }, [pollStats])

  async function pickTable(t: LiveTable) {
    let targetOrderId: string | null = null
    if (t.status === 'occupied' && t.sessionId) {
      // Resolved BEFORE the confirm dialog so its copy is actually true —
      // this used to unconditionally promise "will join the same table
      // session" and then place a second, fully separate order regardless.
      if (t.orderCount === 1 && t.orderId) {
        const { data } = await supabase.rpc('order_appendable', { p_order_id: t.orderId })
        if (data === true) targetOrderId = t.orderId
      }
      const ok = await confirm(
        targetOrderId
          ? {
              title: `Add to ${t.label}'s bill?`,
              description: `This table has an active bill — ₹${t.bill} (${t.itemCount} item${t.itemCount === 1 ? '' : 's'}). Your new items will be added to the same bill.`,
              confirmLabel: 'Add to this bill',
            }
          : {
              title: `Start a new order for ${t.label}?`,
              description: `This table already has ₹${t.bill} due (${t.itemCount} item${t.itemCount === 1 ? '' : 's'}). This will start a separate order at the same table.`,
              confirmLabel: 'Start a new order',
            },
      )
      if (!ok) return
    }
    setAppendTargetOrderId(targetOrderId)
    setSelectedTableId(t.id)
    setTableSelectorOpen(false)
  }

  // Fallback resolver for the paths that don't go through pickTable's own
  // interactive check — resuming a held order, and restoring a table
  // selection from the sessionStorage draft on remount. Harmless to also
  // re-run after pickTable (liveTables changing on the next poll re-fires
  // this), since order_appendable is a cheap read-only check.
  useEffect(() => {
    if (orderType !== 'dine_in' || !selectedTableId) { setAppendTargetOrderId(null); return }
    const t = liveTables.find((lt) => lt.id === selectedTableId)
    if (!t || t.orderCount !== 1 || !t.orderId) { setAppendTargetOrderId(null); return }
    let cancelled = false
    supabase.rpc('order_appendable', { p_order_id: t.orderId }).then(({ data }) => {
      if (!cancelled) setAppendTargetOrderId(data === true ? (t.orderId as string) : null)
    })
    return () => { cancelled = true }
  }, [orderType, selectedTableId, liveTables, supabase])

  const existingSession = useMemo(() => {
    const t = liveTables.find((lt) => lt.id === selectedTableId)
    if (!t || !t.sessionId) return null
    return { total: t.bill, itemCount: t.itemCount, due: t.due, payState: t.payState }
  }, [liveTables, selectedTableId])

  // ── Customer phone lookup: name/visits/points suggestion ─────────────────
  useEffect(() => {
    if (customerPhone.length !== 10) {
      setCustomerLookup(null)
      return
    }
    let cancelled = false
    setLookingUpCustomer(true)
    supabase.rpc('pos_lookup_customer', { p_cafe_id: cafeId, p_phone: customerPhone }).then(({ data }) => {
      if (cancelled) return
      setLookingUpCustomer(false)
      const lookup = data as CustomerLookup
      setCustomerLookup(lookup)
      // Never overwrites a name staff already typed — only fills a blank
      // field, so entering a different, new customer's name first still wins
      // even if the phone happens to also match someone else on file.
      if (lookup?.found && lookup.name) {
        setCustomerName((current) => (current.trim() ? current : lookup.name!))
      }
    })
    return () => {
      cancelled = true
    }
  }, [customerPhone, cafeId, supabase])

  // ── Held orders ────────────────────────────────────────────────────────
  const fetchHeld = useCallback(async () => {
    const { data } = await supabase
      .from('held_orders')
      .select('id, order_type, table_id, customer_phone, customer_name, cart, created_at')
      .eq('cafe_id', cafeId)
      .order('created_at', { ascending: false })
    setHeldRows((data ?? []) as HeldRow[])
  }, [supabase, cafeId])

  useEffect(() => {
    void fetchHeld()
  }, [fetchHeld])

  const heldViewModels: HeldOrder[] = useMemo(
    () =>
      heldRows.map((h) => {
        const itemCount = h.cart.reduce((s, l) => s + l.qty, 0)
        const total = h.cart.reduce((s, l) => s + l.unitPrice * l.qty, 0)
        const tableLabel = h.table_id ? (tables.find((t) => t.id === h.table_id)?.label ?? null) : null
        return {
          id: h.id,
          order_type: h.order_type,
          table_id: h.table_id,
          table_label: tableLabel,
          customer_name: h.customer_name,
          customer_phone: h.customer_phone,
          label: null,
          created_at: h.created_at,
          itemCount,
          total,
        }
      }),
    [heldRows, tables],
  )

  async function holdOrder() {
    if (cart.length === 0) return
    setHolding(true)
    const { error: holdErr } = await supabase.from('held_orders').insert({
      cafe_id: cafeId,
      order_type: orderType,
      table_id: orderType === 'dine_in' ? selectedTableId : null,
      customer_phone: customerPhone || null,
      customer_name: customerName || null,
      cart,
    })
    setHolding(false)
    if (holdErr) {
      toast(holdErr.message, 'error')
      return
    }
    toast('Order held.')
    setCart([])
    setCustomerPhone('')
    setCustomerName('')
    setSelectedTableId(null)
    setDiscountType(null)
    setDiscountValue('')
    setCouponCode('')
    setAppliedCoupon(null)
    setCouponError(null)
    setSpinPrize(null)
    setCartOpen(false)
    void fetchHeld()
  }

  function resumeHeld(id: string) {
    const row = heldRows.find((h) => h.id === id)
    if (!row) return
    setCart(row.cart ?? [])
    setOrderType(row.order_type)
    setSelectedTableId(row.table_id)
    setCustomerPhone(row.customer_phone ?? '')
    setCustomerName(row.customer_name ?? '')
    setHeldOrdersOpen(false)
    void supabase.from('held_orders').delete().eq('id', id).then(({ error }) => {
      if (error) toast(`Resumed, but couldn't clear the held slot: ${error.message}`, 'error')
      void fetchHeld()
    })
  }

  // A held spin prize is only a checked-but-not-yet-redeemed code — nothing
  // is spent until staff_place_order actually runs. Closing the review
  // screen without placing the order (the X button, or Escape) means this
  // attempt is abandoned; unlike the cart/discount/coupon/customer info
  // (which the draft-restore effect above deliberately keeps so reopening
  // resumes the same in-progress order), the prize shouldn't keep riding
  // along in case a DIFFERENT order gets built next — clear it here rather
  // than at every place cartOpen is toggled off.
  function closeCart() {
    setCartOpen(false)
    setSpinPrize(null)
  }

  async function discardHeld(id: string) {
    const ok = await confirm({ title: 'Discard held order?', description: 'This cannot be undone.', confirmLabel: 'Discard', destructive: true })
    if (!ok) return
    const { error } = await supabase.from('held_orders').delete().eq('id', id)
    if (error) return toast(error.message, 'error')
    void fetchHeld()
  }

  // ── Escape closes whichever overlay is open, topmost first; / and Ctrl/Cmd+K
  //    focus search — guarded so they never eat a keystroke meant for a real
  //    text field (phone, name, discount amount, coupon code, etc.) ─────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (customizing) return setCustomizing(null)
        if (tableSelectorOpen) return setTableSelectorOpen(false)
        if (heldOrdersOpen) return setHeldOrdersOpen(false)
        if (cartOpen) return closeCart()
        return
      }
      const typingTarget = e.target instanceof HTMLElement
        && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchInputRef.current?.focus()
        return
      }
      if (e.key === '/' && !typingTarget) {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [customizing, tableSelectorOpen, heldOrdersOpen, cartOpen])

  // Distinct categories actually in the cart right now — lets the server
  // reject (or the suggestion list hide) a coupon restricted to categories
  // this order doesn't contain, e.g. a coffee-only offer on a burgers order.
  function cartCategoryIds(): string[] {
    const ids = new Set<string>()
    const addFor = (itemId: string) => {
      const cat = items.find((i) => i.id === itemId)?.category_id
      if (cat) ids.add(cat)
    }
    for (const line of cart) {
      if (line.comboId) {
        // Match what the server derives from the expanded component rows, so
        // a category-scoped coupon previews the same way it will resolve.
        for (const s of slotsOf(comboSlots, line.comboId)) {
          if (s.kind === 'fixed' && s.menu_item_id) addFor(s.menu_item_id)
        }
        for (const sel of line.selections ?? []) addFor(sel.item_id)
        continue
      }
      addFor(line.itemId)
    }
    return [...ids]
  }

  async function applyCoupon(codeOverride?: string) {
    const code = (codeOverride ?? couponCode).trim()
    if (!code) return
    const subtotal = cart.reduce((s, l) => s + l.unitPrice * l.qty, 0)
    setCouponChecking(true)
    setCouponError(null)
    setApplicableCoupons(null)
    // Preview only — staff_place_order recomputes and redeems this exact same
    // way server-side, so a stale preview here can never overcharge or
    // undercharge; it can only be out of date by the time of placement.
    const { data, error: err } = await supabase.rpc('validate_coupon', {
      p_cafe_id: cafeId,
      p_code: code,
      p_subtotal: subtotal,
      p_customer_phone: customerPhone || null,
      p_category_ids: cartCategoryIds(),
    })
    setCouponChecking(false)
    if (err) return setCouponError(err.message)
    const r = data as { code: string; discount: number; name: string | null }
    setAppliedCoupon({ code: r.code, discount: r.discount, name: r.name })
    setCouponCode('')
  }

  function removeCoupon() {
    setAppliedCoupon(null)
    setCouponError(null)
  }

  // Tapping the (empty) coupon field suggests what's actually usable on this
  // cart right now, so staff don't need to already know a code — the same
  // eligibility check validate_coupon runs, just for every coupon at once.
  async function loadApplicableCoupons() {
    if (couponCode.trim() || cart.length === 0) return
    const subtotal = cart.reduce((s, l) => s + l.unitPrice * l.qty, 0)
    setCouponSuggestionsLoading(true)
    const { data, error: err } = await supabase.rpc('list_applicable_coupons', {
      p_cafe_id: cafeId,
      p_subtotal: subtotal,
      p_customer_phone: customerPhone || null,
      p_category_ids: cartCategoryIds(),
    })
    setCouponSuggestionsLoading(false)
    if (err) {
      // Surfaced (not silently dropped) so a real permission/config problem
      // is visible instead of just "nothing happens when I tap the field."
      console.error('list_applicable_coupons failed:', err.message)
      setApplicableCoupons([])
      return
    }
    setApplicableCoupons(data as { code: string; name: string | null; kind: string; value: number; discount: number }[])
  }

  function pickApplicableCoupon(code: string) {
    setCouponCode(code)
    setApplicableCoupons(null)
    void applyCoupon(code)
  }

  function dismissApplicableCoupons() {
    setTimeout(() => setApplicableCoupons(null), 150)
  }

  // Rewards linked to a menu item: redeeming is a local cart edit only — no
  // network call, nothing spent yet. The real point debit happens
  // server-side inside staff_place_order, atomically with the order it's
  // attached to, so an abandoned order never costs the customer anything.
  // The displayed balance (pendingRewardPoints) is a preview, derived from
  // the cart, never the source of truth.
  //
  // Rewards with no linked item (0121: optional again) have no cart line to
  // add — they fall back to the original standalone redeem_reward RPC,
  // exactly like before this whole fix: points are spent immediately, staff
  // hand over whatever it is themselves, nothing appears on the order.
  async function redeemReward(rewardId: string) {
    const reward = rewards.find((r) => r.id === rewardId)
    if (!reward) return

    if (!reward.menu_item_id) {
      if (!customerPhone) return
      const { data, error } = await supabase.rpc('redeem_reward', {
        p_cafe_id: cafeId, p_customer_phone: customerPhone, p_reward_id: rewardId,
      })
      if (error) return toast(error.message, 'error')
      const r = data as { reward: string; points_spent: number; remaining_balance: number }
      toast(`Redeemed "${r.reward}" — ${r.remaining_balance} points left.`)
      setCustomerLookup((c) => (c ? { ...c, points: r.remaining_balance } : c))
      return
    }

    const item = items.find((i) => i.id === reward.menu_item_id)
    if (!item) return toast('This reward\'s item is no longer available.', 'error')
    const v = reward.variant_id ? variantsByItem.get(reward.menu_item_id)?.find((x) => x.id === reward.variant_id) : null
    const key = `reward:${reward.id}`
    setCart((c) => {
      const found = c.find((l) => l.key === key)
      if (found) return c.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l))
      return [
        ...c,
        {
          key,
          itemId: reward.menu_item_id!,
          variantId: reward.variant_id,
          addonIds: [],
          name: item.name,
          modLabel: [v?.name, 'Reward'].filter(Boolean).join(' · '),
          unitPrice: 0,
          qty: 1,
          rewardId: reward.id,
          pointsCost: reward.points_cost,
        },
      ]
    })
  }

  // append_order_items (0218) has none of these — no reward-redemption path,
  // no discount/coupon/spin arguments at all (see 0218's own header for why:
  // resolve_coupon_discount has no idempotency guard, and orders.discount
  // can't be un-mixed back into "what type was it" after the fact). Rather
  // than block staff from using any of these on a table that happens to be
  // appendable, this just quietly falls back to today's new-order path for
  // that one round — appending is a bonus when it applies cleanly, never a
  // requirement.
  const willAppend = Boolean(appendTargetOrderId)
    && orderType === 'dine_in'
    && cart.every((l) => !l.rewardId)
    && !spinPrize
    && !appliedCoupon
    && !(discountType && (Number(discountValue) || 0) > 0)

  async function placeOrder() {
    if (orderType === 'dine_in' && !selectedTableId) return
    // Takeaway collects now on a real tender (bill → PAID) or is explicitly
    // left unpaid ("Payment Pending"). Dine-in always sends unpaid — its bill
    // runs and is settled later at the table. Money is booked server-side by
    // staff_place_order via record_payment; the browser never marks it paid.
    const settle = orderType === 'takeaway' && tender !== 'pending'
    const method = settle ? tender : 'counter'
    const reason = orderType === 'takeaway' && tender === 'pending' ? pendingReason || null : null
    setPlacing(true)
    setError(null)
    if (!requestId.current) requestId.current = crypto.randomUUID()
    const { data, error: rpcError } = willAppend
      ? await supabase.rpc('append_order_items', {
          p_order_id: appendTargetOrderId,
          p_items: cart.map((l) =>
            l.comboId
              ? { combo_id: l.comboId, qty: l.qty, selections: l.selections ?? [] }
              : { item_id: l.itemId, qty: l.qty, variant_id: l.variantId, addon_ids: l.addonIds, note: l.note || null },
          ),
          p_client_request_id: requestId.current,
        })
      // p_spin_code is sent only when a prize is actually attached. PostgREST
      // picks the overload from the keys it receives, so an ordinary bill still
      // resolves against the pre-0126 signature — the till keeps working if the
      // code ships ahead of the migration, and only a spin claim would fail.
      : await supabase.rpc('staff_place_order', {
          p_cafe_id: cafeId,
          p_items: cart.map((l) =>
            l.comboId
              ? { combo_id: l.comboId, qty: l.qty, selections: l.selections ?? [] }
              : { item_id: l.itemId, qty: l.qty, variant_id: l.variantId, addon_ids: l.addonIds, note: l.note || null, reward_id: l.rewardId || null },
          ),
          p_order_type: orderType,
          p_table_id: orderType === 'dine_in' ? selectedTableId : null,
          p_payment_method: method,
          p_customer_phone: customerPhone || null,
          p_customer_name: customerName || null,
          p_discount_type: discountType,
          p_discount_value: Number(discountValue) || 0,
          p_settle: settle,
          p_pending_reason: reason,
          p_client_request_id: requestId.current,
          p_coupon_code: appliedCoupon?.code ?? null,
          ...(spinPrize ? { p_spin_code: spinPrize.code } : {}),
        })
    setPlacing(false)
    if (rpcError) return setError(spinFailureHint(rpcError.message))
    requestId.current = null

    if (willAppend) {
      // append_order_items returns order totals, not short_code/receipt_token
      // (Live Tables, its first caller, never needed a bill link) — one cheap
      // follow-up read gets what this screen's success toast needs. Appending
      // can never itself produce a fresh 'paid' bill (order_appendable already
      // required payment_status not in ('paid','refunded') before this ran),
      // so there's nothing new for the WhatsApp auto-send fire-and-forget to
      // pick up — skipped rather than firing a call that's a guaranteed no-op.
      const r = data as { order_id: string; total: number }
      const { data: ord } = await supabase.from('orders').select('short_code, receipt_token').eq('id', r.order_id).single()
      setSuccess({ code: ord?.short_code ?? '', total: r.total, token: ord?.receipt_token ?? '', paid: false, appended: true })
    } else {
      const r = data as { short_code: string; total: number; receipt_token: string; payment_status: string }
      setSuccess({ code: r.short_code, total: r.total, token: r.receipt_token, paid: r.payment_status === 'paid', appended: false })
      // Fire-and-forget: since 0215, an "order placed" WhatsApp is never
      // queued — only the "bill" message is, and only once payment is
      // actually recorded (which record_payment/settle above may have just
      // done). If this order settled immediately, the DB trigger has queued
      // that bill log; send whatever's pending now instead of waiting for
      // staff to notice it in the Tables page. On an unsettled order there is
      // nothing pending yet, and this call is a harmless no-op.
      fetch('/api/whatsapp/auto-send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ receipt_token: r.receipt_token }),
      }).catch(() => {})
    }
    setCart([])
    setCartOpen(false)
    setCustomerPhone('')
    setCustomerName('')
    setCustomerLookup(null)
    setSelectedTableId(null)
    setDiscountType(null)
    setDiscountValue('')
    setCouponCode('')
    setAppliedCoupon(null)
    setCouponError(null)
    setSpinPrize(null)
    setTender('cash')
    setPendingReason('')
    void pollTables()
    setTimeout(() => setSuccess(null), 6000)
  }

  const selectedTable = liveTables.find((t) => t.id === selectedTableId) ?? null
  const selectedAreaName = selectedTable?.areaId ? (areas.find((a) => a.id === selectedTable.areaId)?.name ?? null) : null
  const cartCount = cart.reduce((s, l) => s + l.qty, 0)
  const cartTotal = cart.reduce((s, l) => s + l.unitPrice * l.qty, 0)

  // Preview only — the real balance lives server-side and is only ever
  // actually spent inside staff_place_order. Deriving this from the cart
  // (rather than mutating customerLookup.points on redeem) means remove/
  // qty-change/hold/resume all show the right number for free, and it
  // naturally tightens the reward pills' own "can afford this" filter.
  const pendingRewardPoints = useMemo(
    () => cart.reduce((s, l) => s + (l.rewardId ? (l.pointsCost ?? 0) * l.qty : 0), 0),
    [cart],
  )
  // Mirrors 0126's rule so the till shows a truthful total before the bill
  // exists. The server recomputes it and is the authority — a free-item prize
  // whose item isn't on the bill shows ₹0 here and is refused there.
  const spinDiscount = useMemo(() => {
    if (!spinPrize) return 0
    if (spinPrize.kind === 'flat') return spinPrize.value
    if (spinPrize.kind === 'percent') return Math.round((cartTotal * spinPrize.value) / 100)
    if (spinPrize.kind === 'item') {
      const won = cart.filter(
        (l) => l.itemId === spinPrize.menu_item_id &&
          (!spinPrize.variant_id || l.variantId === spinPrize.variant_id),
      )
      return won.length ? Math.max(...won.map((l) => l.unitPrice)) : 0
    }
    return 0
  }, [spinPrize, cart, cartTotal])

  const displayedCustomerLookup = customerLookup
    ? { ...customerLookup, points: Math.max(0, (customerLookup.points ?? 0) - pendingRewardPoints) }
    : null

  const cartProps = {
    loyaltyEnabled,
    spinEnabled,
    couponsEnabled,
    gstRegistered,
    taxInclusive,
    itemTaxRates,
    tableLabel: selectedTable?.label ?? null,
    tableArea: selectedAreaName,
    orderType,
    onOrderType: setOrderType,
    dineInEnabled: dineIn,
    takeawayEnabled: takeaway,
    bothEnabled,
    onOpenTableSelector: () => setTableSelectorOpen(true),
    onFocusSearch: () => {
      setCartOpen(false)
      searchInputRef.current?.focus()
    },
    existingSession,
    willAppend,
    recommendations: recs,
    onAddRecommendation: addRecommendation,
    lines: cart,
    onQty: changeQty,
    onRemove: removeLine,
    onNote: noteLine,
    taxPercent,
    serviceChargePercent,
    tender,
    onTender: setTender,
    pendingReason,
    onPendingReason: setPendingReason,
    customerPhone,
    onCustomerPhone: setCustomerPhone,
    customerName,
    onCustomerName: setCustomerName,
    customerLookup: displayedCustomerLookup,
    lookingUpCustomer,
    role,
    cafeId,
    spinPrize,
    spinDiscount,
    onHoldSpinPrize: setSpinPrize,
    onClearSpinPrize: () => setSpinPrize(null),
    discountType,
    discountValue,
    onDiscountType: setDiscountType,
    onDiscountValue: setDiscountValue,
    couponCode,
    onCouponCode: setCouponCode,
    appliedCoupon,
    couponChecking,
    couponError,
    onApplyCoupon: () => applyCoupon(),
    onRemoveCoupon: removeCoupon,
    applicableCoupons,
    couponSuggestionsLoading,
    onFocusCouponField: loadApplicableCoupons,
    onBlurCouponField: dismissApplicableCoupons,
    onPickApplicableCoupon: pickApplicableCoupon,
    rewards: loyaltyEnabled ? rewards : [],
    onRedeemReward: redeemReward,
    onPlaceOrder: placeOrder,
    placing,
    error,
    onHold: holdOrder,
    holding,
    heldCount: heldRows.length,
    onOpenHeld: () => setHeldOrdersOpen(true),
  }

  const activeTables = liveTables.filter((t) => t.sessionId).length
  const showingCombos = activeCategory === '__combos'
  const activeLabel = activeCategory === 'all' ? 'All Items'
    : activeCategory === '__combos' ? 'Combos'
    : activeCategory === '__bestsellers' ? 'Best Sellers'
    : activeCategory === '__new' ? 'New Arrivals'
    : categoryDisplayName(categoryList.find((c) => c.id === activeCategory)?.name ?? 'Items')

  return (
    <div className="flex h-[calc(100dvh-56px)] w-full min-w-0 flex-col overflow-hidden">
      <div className="flex w-full min-w-0 flex-1 items-stretch overflow-hidden">
        {/* Category rail — sits between the main sidebar and the food grid,
            always visible (not hidden below lg like the cart) since staying
            visible at a glance is the whole point of it. Its own list
            scrolls internally (overflow-y-auto inside CategoryTabs) if a
            café has enough categories to overflow; the rail's width itself
            never changes. */}
        <div className="h-full w-[110px] shrink-0 overflow-hidden border-r border-border bg-surface sm:w-[150px] lg:w-[192px] xl:w-[200px]">
          <CategoryTabs
            categories={categoryList}
            bestsellerCount={bestsellerCount}
            newCount={newItemIds.size}
            comboCount={combos.length}
            activeId={activeCategory}
            onSelect={setActiveCategory}
            onAddCategory={canManageCategories ? addCategory : undefined}
            addingCategory={addingCategory}
            totalCount={items.length}
          />
        </div>

        {/* Workspace — only this column's product grid scrolls; the search
            bar stays put and the cart sibling never moves. */}
        <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-border bg-surface px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="relative w-full max-w-md">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  ref={searchInputRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search items, categories or scan barcode…"
                  className="h-[52px] w-full rounded-[var(--radius)] border border-border-strong bg-surface-subtle pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-border-strong bg-surface px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground sm:inline-block">
                  /
                </span>
              </div>

              {/* Desktop's entry point into the order — table/order-type,
                  item count, running total, opens the same consolidated
                  review modal the mobile floating pill below opens. Orange
                  once there's something to review; a quieter outline style
                  beforehand (also doubles as the "pick a table" entry point
                  before any items exist). */}
              <button
                onClick={() => setCartOpen(true)}
                className={`ml-auto hidden h-[52px] shrink-0 items-center gap-2 rounded-[var(--radius)] px-4 text-[13px] font-medium transition-colors lg:flex ${
                  cartCount > 0
                    ? 'bg-primary text-primary-foreground hover:bg-primary-hover'
                    : 'border border-border-strong bg-surface text-foreground hover:bg-surface-subtle'
                }`}
              >
                <ClipboardList size={16} className={cartCount > 0 ? 'text-primary-foreground/80' : 'text-muted-foreground'} />
                <span>{orderType === 'dine_in' ? (selectedTable?.label ?? 'Select table') : 'Takeaway'}</span>
                {cartCount > 0 && (
                  <>
                    <span className="text-primary-foreground/60">·</span>
                    <span>{cartCount} item{cartCount === 1 ? '' : 's'}</span>
                    <span className="font-semibold">₹{cartTotal}</span>
                  </>
                )}
                <ArrowRight size={15} className={cartCount > 0 ? 'text-primary-foreground/80' : 'text-muted-foreground'} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 pb-24 lg:pb-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-[15px] font-semibold tracking-tight text-foreground">{activeLabel}</h2>
              <div className="flex items-center gap-3">
                <span className="text-[12.5px] text-muted-foreground">
                  {showingCombos
                    ? `${combos.length} combo${combos.length === 1 ? '' : 's'}`
                    : `${visible.length} item${visible.length === 1 ? '' : 's'}`}
                </span>
                {!showingCombos && (
                  <select
                    value={sortMode}
                    onChange={(e) => setSortMode(e.target.value as typeof sortMode)}
                    aria-label="Sort items"
                    className="h-8 rounded-[var(--radius-sm)] border border-border-strong bg-surface px-2 text-[12px] font-medium text-foreground"
                  >
                    <option value="popular">Sort: Popular</option>
                    <option value="price_low">Sort: Price (low first)</option>
                    <option value="price_high">Sort: Price (high first)</option>
                    <option value="name">Sort: Name (A–Z)</option>
                  </select>
                )}
              </div>
            </div>
            {showingCombos ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {combos.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setCombobuilding(c)}
                    className="rounded-[var(--radius-lg)] border border-border bg-surface p-4 text-left transition-colors hover:border-primary hover:bg-primary-subtle/30"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[14px] font-semibold text-foreground">{c.name}</p>
                      <span className="shrink-0 text-[14px] font-semibold text-primary">₹{c.price}</span>
                    </div>
                    <p className="mt-1 text-[12px] text-muted-foreground">
                      {slotsOf(comboSlots, c.id)
                        .map((s) => (s.qty > 1 ? `${s.label} × ${s.qty}` : s.label))
                        .join(' · ') || 'No items set'}
                    </p>
                  </button>
                ))}
              </div>
            ) : visible.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">No items match.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                {visible.map((item) => (
                  <ProductCard
                    key={item.id}
                    item={item}
                    qty={qtyByItem.get(item.id) ?? 0}
                    isOfferActiveToday={offerActiveIds.has(item.id)}
                    onAdd={handleAddItem}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom live strip — real numbers, collapsed below lg so it never
          competes with ordering on tablet/mobile. Spans the full width,
          under both the product area and the cart. */}
      {stats && (
        <div className="hidden shrink-0 items-stretch gap-px overflow-x-auto border-t border-border bg-border lg:flex">
          <StatTile label="Today's sales" value={`₹${stats.collected.toLocaleString('en-IN')}`} icon={<TrendingUp size={15} />} changePct={stats.collectedChangePct} />
          <StatTile label="Orders" value={String(stats.orders)} icon={<ClipboardList size={15} />} changePct={stats.ordersChangePct} />
          <StatTile label="Average order value" value={`₹${stats.aov}`} icon={<TrendingUp size={15} />} changePct={stats.aovChangePct} />
          <StatTile label="Active tables" value={`${activeTables} / ${tables.length}`} icon={<Users size={15} />} />
          <StatTile label="Kitchen" value={`${stats.preparing} Preparing · ${stats.ready} Ready`} icon={<ChefHat size={15} />} />
        </div>
      )}

      {/* Cart trigger — a floating pill on mobile/tablet (below lg), where
          there's no room for a header chip. Desktop's equivalent trigger
          lives up in the search row instead (see below). Both just open the
          same modal via cartOpen; CartPanel renders nothing but that modal
          now, so there's no separate sheet wrapper needed here anymore. */}
      {!cartOpen && cartCount > 0 && (
        <button
          onClick={() => setCartOpen(true)}
          className="fixed inset-x-4 bottom-4 z-30 flex min-h-12 items-center justify-between rounded-[var(--radius)] bg-primary px-5 text-primary-foreground shadow-[var(--shadow-lg)] lg:hidden"
        >
          <span className="text-[14px] font-medium">{cartCount} item{cartCount === 1 ? '' : 's'}</span>
          <span className="text-[15px] font-semibold">₹{cartTotal} · View cart</span>
        </button>
      )}
      <CartPanel {...cartProps} open={cartOpen} onClose={closeCart} />

      {tableSelectorOpen && (
        <TableSelector tables={liveTables} areas={areas} onPick={pickTable} onClose={() => setTableSelectorOpen(false)} />
      )}

      {combobuilding && (
        <ComboPicker
          combo={combobuilding}
          slots={slotsOf(comboSlots, combobuilding.id)}
          items={items}
          variants={variants}
          onCancel={() => setCombobuilding(null)}
          onAdd={(selections) => addCombo(combobuilding, selections)}
        />
      )}

      {heldOrdersOpen && (
        <HeldOrdersDrawer
          orders={heldViewModels}
          onResume={resumeHeld}
          onDiscard={discardHeld}
          onClose={() => setHeldOrdersOpen(false)}
          timezone={timezone}
        />
      )}

      {customizing && (
        <Customizer
          item={customizing}
          variants={variantsByItem.get(customizing.id) ?? []}
          addons={addonsByItem.get(customizing.id) ?? []}
          basePrice={effectivePrice(customizing, todayWeekday)}
          isOfferActiveToday={offerActiveIds.has(customizing.id)}
          onCancel={() => setCustomizing(null)}
          onAdd={confirmCustom}
        />
      )}

      {success && (
        <div className={`fixed left-1/2 top-4 z-50 flex -translate-x-1/2 items-center gap-3 rounded-[var(--radius)] border px-4 py-3 shadow-[var(--shadow-lg)] ${success.paid ? 'border-success bg-success-subtle' : 'border-warning bg-warning-subtle'}`}>
          <span className="text-[13px] font-medium text-foreground">
            {success.appended ? `Added to bill #${success.code}` : `Order #${success.code}`} · ₹{success.total} · {success.paid ? 'Paid' : 'Payment due'}
          </span>
          <a href={`/r/${success.token}`} target="_blank" className="text-[13px] font-semibold text-primary hover:underline">
            View bill →
          </a>
          <a href={`/r/${success.token}?print=1`} target="_blank" className="text-[13px] font-semibold text-primary hover:underline">
            Print bill
          </a>
        </div>
      )}
    </div>
  )
}

function StatTile({
  label, value, icon, changePct,
}: { label: string; value: string; icon: React.ReactNode; changePct?: number | null }) {
  return (
    <div className="flex min-w-[150px] flex-1 items-center gap-2.5 bg-surface px-4 py-2">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary-subtle text-primary">{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-[11px] text-muted-foreground">{label}</p>
        <div className="flex items-baseline gap-1.5">
          <p className="truncate text-[14px] font-semibold text-foreground">{value}</p>
          {typeof changePct === 'number' && (
            <span className={`shrink-0 text-[10.5px] font-medium ${changePct > 0 ? 'text-success' : changePct < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
              {changePct > 0 ? '↑' : changePct < 0 ? '↓' : ''}{Math.abs(changePct)}% vs yesterday
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// Customizer (variant/add-on modal) now lives in components/pos/customizer.tsx.
