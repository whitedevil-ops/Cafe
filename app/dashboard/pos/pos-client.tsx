'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, X, TrendingUp, ClipboardList, Users, ChefHat } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import { CategoryTabs, type PosCategory } from '@/components/pos/category-tabs'
import { ProductCard, type PosItem } from '@/components/pos/product-card'
import { CartPanel, type CartLine, type PosTable, type PosArea, type CustomerLookup, type Tender } from '@/components/pos/cart-panel'
import { TableSelector, type LiveTable } from '@/components/pos/table-selector'
import { fetchRecommendations, logRecommendationEvent, type Recommendation } from '@/lib/recommend'
import { HeldOrdersDrawer, type HeldOrder } from '@/components/pos/held-orders-drawer'
import { businessDayStartISO } from '@/lib/datetime'
import type { PosVariant, PosAddon } from './page'

// Same freshness window as the customer QR menu (menu-client.tsx) — one
// definition of "new" would be nicer as a shared constant, but duplicating a
// single number here is simpler than adding a cross-surface import for it.
const NEW_ITEM_DAYS = 14

type FullItem = PosItem & { category_id: string | null }
type Line = CartLine & { itemId: string; variantId: string | null; addonIds: string[] }
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
}) {
  const supabase = useMemo(() => createClient(), [])
  const confirm = useConfirm()
  const { toast } = useToast()

  const [activeCategory, setActiveCategory] = useState<string | 'all'>('all')
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<Line[]>([])
  // Respect the café's enabled order types. If both are off (shouldn't happen)
  // fall back to dine-in so the POS still renders; the server trigger (0051) is
  // the real gate regardless of what the UI offers.
  const bothEnabled = dineIn && takeaway
  const [orderType, setOrderType] = useState<'dine_in' | 'takeaway'>(takeaway && !dineIn ? 'takeaway' : 'dine_in')
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null)
  const [tender, setTender] = useState<Tender>('cash')
  const [pendingReason, setPendingReason] = useState('')
  const [customizing, setCustomizing] = useState<FullItem | null>(null)
  const [placing, setPlacing] = useState(false)
  // Stable per-attempt key so a network retry can never bill the same order
  // twice — see migration 0056. Cleared once an order actually succeeds.
  const requestId = useRef<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<{ code: string; total: number; token: string; paid: boolean } | null>(null)
  const [cartOpen, setCartOpen] = useState(false)

  const [tableSelectorOpen, setTableSelectorOpen] = useState(false)
  // Seed from the canonical layout (area/position/shape); status fills on poll.
  const seedLive = (t: PosTable): LiveTable => ({
    id: t.id, label: t.label, status: t.occupied ? 'occupied' : 'available', sessionId: null,
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
  const [couponChecking, setCouponChecking] = useState(false)
  const [couponError, setCouponError] = useState<string | null>(null)

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

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items
      .filter((i) => {
        if (activeCategory === 'all') return true
        if (activeCategory === '__bestsellers') return i.is_bestseller
        if (activeCategory === '__new') return newItemIds.has(i.id)
        return i.category_id === activeCategory
      })
      .filter((i) => (q ? i.name.toLowerCase().includes(q) : true))
  }, [items, activeCategory, search, newItemIds])

  const qtyByItem = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of cart) m.set(l.itemId, (m.get(l.itemId) ?? 0) + l.qty)
    return m
  }, [cart])

  // ── Smart cross-sell (deterministic, server-side, fail-safe) ─────────────
  const [recs, setRecs] = useState<Recommendation[]>([])
  const cartItemIds = useMemo(() => [...new Set(cart.map((l) => l.itemId))], [cart])
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
  const [stats, setStats] = useState<{ collected: number; orders: number; aov: number; preparing: number; ready: number } | null>(null)
  const pollStats = useCallback(async () => {
    const dayStart = businessDayStartISO(timezone)
    const [{ data: ords }, { data: kitchen }] = await Promise.all([
      supabase.from('orders').select('total').eq('cafe_id', cafeId).neq('status', 'cancelled').gte('created_at', dayStart),
      supabase.from('orders').select('status').eq('cafe_id', cafeId).in('status', ['preparing', 'ready']),
    ])
    const rows = ords ?? []
    const collected = rows.reduce((s, o) => s + (o.total ?? 0), 0)
    const orderCount = rows.length
    setStats({
      collected,
      orders: orderCount,
      aov: orderCount ? Math.round(collected / orderCount) : 0,
      preparing: (kitchen ?? []).filter((o) => o.status === 'preparing').length,
      ready: (kitchen ?? []).filter((o) => o.status === 'ready').length,
    })
  }, [supabase, cafeId, timezone])

  useEffect(() => {
    void pollStats()
    const p = setInterval(pollStats, 20000)
    return () => clearInterval(p)
  }, [pollStats])

  async function pickTable(t: LiveTable) {
    if (t.status === 'occupied' && t.sessionId) {
      const ok = await confirm({
        title: `Add to ${t.label}'s existing order?`,
        description: `This table has an active order — ₹${t.bill} (${t.itemCount} item${t.itemCount === 1 ? '' : 's'}). Your new items will join the same table session.`,
        confirmLabel: 'Add to this table',
      })
      if (!ok) return
    }
    setSelectedTableId(t.id)
    setTableSelectorOpen(false)
  }

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
      setCustomerLookup(data as CustomerLookup)
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
    setDiscountType(null)
    setDiscountValue('')
    setCouponCode('')
    setAppliedCoupon(null)
    setCouponError(null)
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
    void supabase.from('held_orders').delete().eq('id', id).then(() => fetchHeld())
  }

  async function discardHeld(id: string) {
    const ok = await confirm({ title: 'Discard held order?', description: 'This cannot be undone.', confirmLabel: 'Discard', destructive: true })
    if (!ok) return
    await supabase.from('held_orders').delete().eq('id', id)
    void fetchHeld()
  }

  // ── Escape closes whichever overlay is open, topmost first ───────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (customizing) return setCustomizing(null)
      if (tableSelectorOpen) return setTableSelectorOpen(false)
      if (heldOrdersOpen) return setHeldOrdersOpen(false)
      if (cartOpen) return setCartOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [customizing, tableSelectorOpen, heldOrdersOpen, cartOpen])

  async function applyCoupon() {
    const code = couponCode.trim()
    if (!code) return
    const subtotal = cart.reduce((s, l) => s + l.unitPrice * l.qty, 0)
    setCouponChecking(true)
    setCouponError(null)
    // Preview only — staff_place_order recomputes and redeems this exact same
    // way server-side, so a stale preview here can never overcharge or
    // undercharge; it can only be out of date by the time of placement.
    const { data, error: err } = await supabase.rpc('validate_coupon', {
      p_cafe_id: cafeId,
      p_code: code,
      p_subtotal: subtotal,
      p_customer_phone: customerPhone || null,
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
    const { data, error: rpcError } = await supabase.rpc('staff_place_order', {
      p_cafe_id: cafeId,
      p_items: cart.map((l) => ({ item_id: l.itemId, qty: l.qty, variant_id: l.variantId, addon_ids: l.addonIds, note: l.note || null })),
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
    })
    setPlacing(false)
    if (rpcError) return setError(rpcError.message)
    requestId.current = null
    const r = data as { short_code: string; total: number; receipt_token: string; payment_status: string }
    setSuccess({ code: r.short_code, total: r.total, token: r.receipt_token, paid: r.payment_status === 'paid' })
    setCart([])
    setCartOpen(false)
    setCustomerPhone('')
    setCustomerName('')
    setCustomerLookup(null)
    setDiscountType(null)
    setDiscountValue('')
    setCouponCode('')
    setAppliedCoupon(null)
    setCouponError(null)
    setTender('cash')
    setPendingReason('')
    void pollTables()
    setTimeout(() => setSuccess(null), 6000)
  }

  const selectedTable = liveTables.find((t) => t.id === selectedTableId) ?? null
  const selectedAreaName = selectedTable?.areaId ? (areas.find((a) => a.id === selectedTable.areaId)?.name ?? null) : null
  const cartCount = cart.reduce((s, l) => s + l.qty, 0)
  const cartTotal = cart.reduce((s, l) => s + l.unitPrice * l.qty, 0)

  const cartProps = {
    tableLabel: selectedTable?.label ?? null,
    tableArea: selectedAreaName,
    orderType,
    onOrderType: setOrderType,
    dineInEnabled: dineIn,
    takeawayEnabled: takeaway,
    bothEnabled,
    onOpenTableSelector: () => setTableSelectorOpen(true),
    existingSession,
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
    customerLookup,
    lookingUpCustomer,
    role,
    discountType,
    discountValue,
    onDiscountType: setDiscountType,
    onDiscountValue: setDiscountValue,
    couponCode,
    onCouponCode: setCouponCode,
    appliedCoupon,
    couponChecking,
    couponError,
    onApplyCoupon: applyCoupon,
    onRemoveCoupon: removeCoupon,
    onPlaceOrder: placeOrder,
    placing,
    error,
    onHold: holdOrder,
    holding,
    heldCount: heldRows.length,
    onOpenHeld: () => setHeldOrdersOpen(true),
  }

  const activeTables = liveTables.filter((t) => t.sessionId).length
  const activeLabel = activeCategory === 'all' ? 'All Items'
    : activeCategory === '__bestsellers' ? 'Best Sellers'
    : activeCategory === '__new' ? 'New Arrivals'
    : (categories.find((c) => c.id === activeCategory)?.name ?? 'Items')

  return (
    <div className="flex h-[calc(100dvh-56px)] w-full min-w-0 flex-col overflow-hidden">
      <div className="flex w-full min-w-0 flex-1 items-stretch overflow-hidden">
        {/* Workspace — only this column's product grid scrolls; the search
            and category strip stay put and the cart sibling never moves.
            No permanent category sidebar — categories run horizontally
            across the top at every breakpoint, per the approved design. */}
        <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-border bg-surface px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search items, categories or scan barcode"
                  className="h-11 w-full rounded-[var(--radius)] border border-border-strong bg-surface-subtle pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground"
                />
              </div>
            </div>
            <div className="mt-3">
              <CategoryTabs
                categories={categories}
                bestsellerCount={bestsellerCount}
                newCount={newItemIds.size}
                activeId={activeCategory}
                onSelect={setActiveCategory}
                totalCount={items.length}
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5 pb-24 lg:pb-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold tracking-tight text-foreground">{activeLabel}</h2>
              <span className="text-[12.5px] text-muted-foreground">{visible.length} item{visible.length === 1 ? '' : 's'}</span>
            </div>
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

        {/* Cart — persistent right panel on desktop. Parent row is height-capped
            and non-scrolling, so a plain h-full (no sticky/dvh) keeps it fixed
            while the product grid scrolls independently. */}
        <div className="hidden h-full w-[360px] shrink-0 border-l border-border lg:block">
          <CartPanel {...cartProps} />
        </div>
      </div>

      {/* Bottom live strip — real numbers, collapsed below lg so it never
          competes with ordering on tablet/mobile. Spans the full width,
          under both the product area and the cart. */}
      {stats && (
        <div className="hidden shrink-0 items-stretch gap-px overflow-x-auto border-t border-border bg-border lg:flex">
          <StatTile label="Today's sales" value={`₹${stats.collected.toLocaleString('en-IN')}`} icon={<TrendingUp size={15} />} />
          <StatTile label="Orders" value={String(stats.orders)} icon={<ClipboardList size={15} />} />
          <StatTile label="Average order value" value={`₹${stats.aov}`} icon={<TrendingUp size={15} />} />
          <StatTile label="Active tables" value={`${activeTables} / ${tables.length}`} icon={<Users size={15} />} />
          <StatTile label="Kitchen" value={`${stats.preparing} Preparing · ${stats.ready} Ready`} icon={<ChefHat size={15} />} />
        </div>
      )}

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

      {tableSelectorOpen && (
        <TableSelector tables={liveTables} areas={areas} onPick={pickTable} onClose={() => setTableSelectorOpen(false)} />
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
          onCancel={() => setCustomizing(null)}
          onAdd={confirmCustom}
        />
      )}

      {success && (
        <div className={`fixed left-1/2 top-4 z-50 flex -translate-x-1/2 items-center gap-3 rounded-[var(--radius)] border px-4 py-3 shadow-[var(--shadow-lg)] ${success.paid ? 'border-success bg-success-subtle' : 'border-warning bg-warning-subtle'}`}>
          <span className="text-[13px] font-medium text-foreground">
            Order #{success.code} · ₹{success.total} · {success.paid ? 'Paid' : 'Payment due'}
          </span>
          <a href={`/r/${success.token}`} target="_blank" className="text-[13px] font-semibold text-primary hover:underline">
            View bill →
          </a>
        </div>
      )}
    </div>
  )
}

function StatTile({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="flex min-w-[150px] flex-1 items-center gap-2.5 bg-surface px-4 py-2.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-subtle text-primary">{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-[11px] text-muted-foreground">{label}</p>
        <p className="truncate text-[14px] font-semibold text-foreground">{value}</p>
      </div>
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
