'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import { useToast } from '@/components/ui/toast'
import { CancelOrderDialog } from '@/components/orders/cancel-order-dialog'
import { RefundDialog, type RefundableItem } from '@/components/orders/refund-dialog'
import { businessDayStart } from '@/lib/datetime'
import { byTableLabel } from '@/lib/table-sort'
import { useRealtimeRefresh } from '@/lib/use-realtime-refresh'
import { QuickAddSheet, type MenuCategory, type MenuItem, type MenuVariant, type MenuAddon } from '@/components/waiter/quick-add-sheet'

export type FloorTable = {
  id: string
  label: string
  capacity: number | null
  status: 'available' | 'occupied' | 'reserved' | 'cleaning'
}

type Session = {
  id: string
  table_id: string
  status: 'active' | 'bill_requested' | 'closed'
  started_at: string
  guest_count: number | null
}
type SessionOrder = {
  id: string
  session_id: string | null
  table_id: string | null
  customer_id: string | null
  short_code: string
  status: 'placed' | 'accepted' | 'preparing' | 'ready' | 'served' | 'completed'
  payment_status: string
  payment_method: string | null
  phone: string | null
  total: number
  receipt_token: string
  created_at: string
}
type Item = { id: string; order_id: string; name: string; qty: number; modifiers: { name: string }[] | null }
type SmsLog = { id: string; order_id: string; status: string; error: string | null }
type Payment = { session_id: string | null; order_id: string | null; amount: number }

const NEXT: Record<string, { label: string; to: string }> = {
  placed: { label: 'Start preparing', to: 'preparing' },
  accepted: { label: 'Start preparing', to: 'preparing' },
  preparing: { label: 'Mark ready', to: 'ready' },
  ready: { label: 'Complete order', to: 'completed' },
  served: { label: 'Complete order', to: 'completed' },
}

const mins = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
const mask = (p: string | null) => (p ? `******${p.slice(-4)}` : null)

export default function FloorClient({
  cafeId,
  timezone,
  initialTables,
  menu,
}: {
  cafeId: string
  timezone: string
  initialTables: FloorTable[]
  menu: { categories: MenuCategory[]; items: MenuItem[]; variants: MenuVariant[]; addons: MenuAddon[] }
}) {
  const supabase = useMemo(() => createClient(), [])
  const { toast } = useToast()
  const [tables, setTables] = useState(initialTables)
  const [sessions, setSessions] = useState<Session[]>([])
  const [orders, setOrders] = useState<SessionOrder[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [payingOrder, setPayingOrder] = useState<string | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [attention, setAttention] = useState<Set<string>>(new Set()) // table ids with unacked call_waiter
  const [selected, setSelected] = useState<string | null>(null)
  const [doneOrders, setDoneOrders] = useState<SessionOrder[]>([])
  const [sms, setSms] = useState<SmsLog[]>([])
  const [pollError, setPollError] = useState<string | null>(null)
  const [lastPollAt, setLastPollAt] = useState<Date | null>(null)
  const [moving, setMoving] = useState(false)
  const [splitting, setSplitting] = useState(false)
  const [splitN, setSplitN] = useState(2)
  const [actionError, setActionError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<SessionOrder | null>(null)
  const [cancelSubmitting, setCancelSubmitting] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [refunding, setRefunding] = useState<SessionOrder | null>(null)
  const [refundSubmitting, setRefundSubmitting] = useState(false)
  const [refundError, setRefundError] = useState<string | null>(null)
  const [refundContext, setRefundContext] = useState<{
    subtotal: number
    alreadyRefunded: number
    items: RefundableItem[]
  } | null>(null)
  const [, tick] = useState(0)
  const selectedRef = useRef<string | null>(null)
  selectedRef.current = selected
  const [quickAdding, setQuickAdding] = useState(false)
  const [quickAddSubmitting, setQuickAddSubmitting] = useState(false)
  const [quickAddError, setQuickAddError] = useState<string | null>(null)

  const poll = useCallback(async () => {
    const [{ data: tbls, error: tblErr }, { data: sess, error: sessErr }] = await Promise.all([
      supabase.from('cafe_tables').select('id, label, capacity, status').eq('cafe_id', cafeId),
      supabase
        .from('table_sessions')
        .select('id, table_id, status, started_at, guest_count')
        .eq('cafe_id', cafeId)
        .in('status', ['active', 'bill_requested']),
    ])
    if (tblErr || sessErr) {
      setPollError((tblErr ?? sessErr)!.message)
      return
    }
    setPollError(null)
    setLastPollAt(new Date())
    if (tbls) setTables(tbls as FloorTable[])
    const sessionRows = (sess ?? []) as Session[]
    setSessions(sessionRows)
    const sessionIds = sessionRows.map((s) => s.id)

    if (sessionIds.length === 0) {
      setOrders([])
      setItems([])
      setPayments([])
    } else {
      const { data: ords } = await supabase
        .from('orders')
        .select('id, session_id, table_id, customer_id, short_code, status, payment_status, payment_method, phone, total, receipt_token, created_at')
        .eq('cafe_id', cafeId)
        .in('session_id', sessionIds)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: true })
      const orderRows = (ords ?? []) as SessionOrder[]
      setOrders(orderRows)

      // Payments attach to a session (split payments) OR a single order
      // (a settled order) — fetch both dimensions so a table's paid amount is
      // never understated by missing the order-level rows.
      const orderIds = orderRows.map((o) => o.id)
      const payFilter = orderIds.length
        ? `session_id.in.(${sessionIds.join(',')}),order_id.in.(${orderIds.join(',')})`
        : `session_id.in.(${sessionIds.join(',')})`
      const [{ data: its }, { data: pays }, custRes] = await Promise.all([
        orderRows.length
          ? supabase.from('order_items').select('id, order_id, name, qty, modifiers').in('order_id', orderIds)
          : Promise.resolve({ data: [] as Item[] }),
        supabase.from('payments').select('session_id, order_id, amount').or(payFilter),
        (async () => {
          const ids = [...new Set(orderRows.map((o) => o.customer_id).filter(Boolean))] as string[]
          if (!ids.length) return { data: [] as { id: string; name: string | null }[] }
          return supabase.from('customers').select('id, name').in('id', ids)
        })(),
      ])
      if (its) setItems(its as Item[])
      setPayments((pays ?? []) as Payment[])
      const map: Record<string, string> = {}
      for (const c of custRes.data ?? []) if (c.name) map[c.id] = c.name
      setNames(map)
    }

    // Unacknowledged call-waiter flags.
    const { data: unread } = await supabase
      .from('notifications')
      .select('table_id')
      .eq('cafe_id', cafeId)
      .eq('type', 'call_waiter')
      .eq('read', false)
    setAttention(new Set((unread ?? []).map((n) => n.table_id).filter(Boolean) as string[]))

    const sel = selectedRef.current
    if (sel) {
      // setHours() would use the DEVICE's timezone — a tablet left on the wrong
      // zone (or a manager checking from abroad) would show the wrong day's
      // completed orders. Always resolve against the café's business day.
      const dayStart = businessDayStart(timezone)
      const { data: done } = await supabase
        .from('orders')
        .select('id, session_id, table_id, customer_id, short_code, status, payment_status, payment_method, phone, total, receipt_token, created_at')
        .eq('cafe_id', cafeId)
        .eq('table_id', sel)
        .eq('status', 'completed')
        .gte('created_at', dayStart.toISOString())
        .order('created_at', { ascending: false })
        .limit(10)
      setDoneOrders((done ?? []) as SessionOrder[])
      if (done?.length) {
        const { data: logs } = await supabase.from('sms_logs').select('id, order_id, status, error').in('order_id', done.map((o) => o.id))
        setSms((logs ?? []) as SmsLog[])
      } else {
        setSms([])
      }
    }
  }, [supabase, cafeId, timezone])

  // Realtime is a supplement, not a replacement: a new order, a call-waiter,
  // or a bill request from another device shows up instantly instead of
  // waiting up to 4s. The interval below keeps running underneath it as the
  // backstop that guarantees the floor is never silently stale.
  useRealtimeRefresh(supabase, 'orders', cafeId, poll)
  useRealtimeRefresh(supabase, 'table_sessions', cafeId, poll)
  useRealtimeRefresh(supabase, 'notifications', cafeId, poll)
  useRealtimeRefresh(supabase, 'payments', cafeId, poll)
  useRealtimeRefresh(supabase, 'payment_attempts', cafeId, poll)

  useEffect(() => {
    // poll() is async and only calls setState after its own network
    // round-trip completes — not a synchronous render-phase update.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void poll()
    const p = setInterval(poll, 4000)
    const t = setInterval(() => tick((n) => n + 1), 30000)
    return () => {
      clearInterval(p)
      clearInterval(t)
    }
  }, [poll])

  const sessionByTable = useMemo(() => new Map(sessions.map((s) => [s.table_id, s])), [sessions])
  const ordersBySession = useMemo(() => {
    const m = new Map<string, SessionOrder[]>()
    for (const o of orders) if (o.session_id) m.set(o.session_id, [...(m.get(o.session_id) ?? []), o])
    return m
  }, [orders])
  // Which session an order belongs to — lets an order-level payment count
  // toward its table's running bill, not just session-level split payments.
  const orderToSession = useMemo(() => {
    const m = new Map<string, string>()
    for (const o of orders) if (o.session_id) m.set(o.id, o.session_id)
    return m
  }, [orders])
  const paidByOrder = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of payments) if (p.order_id) m.set(p.order_id, (m.get(p.order_id) ?? 0) + p.amount)
    return m
  }, [payments])
  const paidBySession = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of payments) {
      const sid = p.session_id ?? (p.order_id ? orderToSession.get(p.order_id) : undefined)
      if (sid) m.set(sid, (m.get(sid) ?? 0) + p.amount)
    }
    return m
  }, [payments, orderToSession])

  // Per-table payment state, computed against the whole running bill so one
  // paid order never marks the table paid while others are still due.
  const payStateByTable = useMemo(() => {
    const m = new Map<string, { total: number; paid: number; due: number; state: 'paid' | 'partial' | 'unpaid' }>()
    for (const s of sessions) {
      const os = ordersBySession.get(s.id) ?? []
      const total = os.reduce((sum, o) => sum + o.total, 0)
      const paid = Math.min(total, paidBySession.get(s.id) ?? 0)
      const due = Math.max(0, total - paid)
      const state = total > 0 && paid >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid'
      m.set(s.table_id, { total, paid, due, state })
    }
    return m
  }, [sessions, ordersBySession, paidBySession])

  const sorted = useMemo(
    () => [...tables].sort(byTableLabel),
    [tables],
  )
  const emptyTables = useMemo(() => sorted.filter((t) => !sessionByTable.has(t.id) && t.id !== selected), [sorted, sessionByTable, selected])

  async function advance(o: SessionOrder) {
    const to = NEXT[o.status]?.to
    if (!to) return
    setOrders((list) => list.map((x) => (x.id === o.id ? { ...x, status: to as SessionOrder['status'] } : x)))
    await supabase.from('orders').update({ status: to, done_at: to === 'completed' ? new Date().toISOString() : null }).eq('id', o.id)
    void poll()
  }

  // Record a counter payment through the server RPC, which validates the
  // amount against the order's real outstanding (rejecting overpayment) and
  // writes the immutable, audited payment row for the full outstanding.
  async function markPaid(o: SessionOrder, method: 'cash' | 'card' | 'upi') {
    const due = Math.max(0, o.total - (paidByOrder.get(o.id) ?? 0))
    if (due <= 0) return
    setPayingOrder(o.id)
    const { error } = await supabase.rpc('record_payment', {
      p_order_id: o.id,
      p_amount: due,
      p_method: method,
      p_reference: null,
      p_source: 'manual',
      p_attempt_id: null,
    })
    setPayingOrder(null)
    if (error) return toast(error.message, 'error')
    toast(`₹${due} recorded${method === 'upi' ? ' by UPI' : ''}.`)
    void poll()
  }

  // Fetches the authoritative refund picture before opening the dialog: what's
  // left to refund, and how many units of each line were already returned.
  // The dialog previews numbers, but refund_order recomputes everything.
  async function openRefund(o: SessionOrder) {
    setRefundError(null)
    const [{ data: settlement }, { data: orderRow }, { data: lines }] = await Promise.all([
      supabase.rpc('order_settlement', { p_order_id: o.id }),
      supabase.from('orders').select('subtotal').eq('id', o.id).maybeSingle(),
      supabase.from('order_items').select('id, name, qty, price').eq('order_id', o.id),
    ])

    const ids = (lines ?? []).map((l) => l.id)
    const { data: priorRefunds } = ids.length
      ? await supabase.from('refund_items').select('order_item_id, qty').in('order_item_id', ids)
      : { data: [] as { order_item_id: string; qty: number }[] }

    const refundedByItem = new Map<string, number>()
    for (const r of priorRefunds ?? []) {
      refundedByItem.set(r.order_item_id, (refundedByItem.get(r.order_item_id) ?? 0) + r.qty)
    }

    const s = settlement as { refunded: number } | null
    setRefundContext({
      subtotal: orderRow?.subtotal ?? o.total,
      alreadyRefunded: s?.refunded ?? 0,
      items: (lines ?? []).map((l) => ({
        id: l.id,
        name: l.name,
        qty: l.qty,
        price: l.price,
        refundedQty: refundedByItem.get(l.id) ?? 0,
      })),
    })
    setRefunding(o)
  }

  async function confirmRefund(args: {
    mode: 'full' | 'partial' | 'item'
    amount: number | null
    method: string
    reason: string
    items: { order_item_id: string; qty: number }[]
  }) {
    if (!refunding) return
    setRefundSubmitting(true)
    setRefundError(null)
    const { data, error } = await supabase.rpc('refund_order', {
      p_order_id: refunding.id,
      p_reason: args.reason,
      p_method: args.method,
      p_amount: args.mode === 'partial' ? args.amount : null,
      p_items: args.mode === 'item' ? args.items : null,
    })
    setRefundSubmitting(false)
    if (error) return setRefundError(error.message)
    const r = data as { amount: number; remaining: number }
    toast(
      r.remaining > 0
        ? `₹${r.amount} refunded — ₹${r.remaining} still refundable.`
        : `₹${r.amount} refunded in full.`,
    )
    setRefunding(null)
    setRefundContext(null)
    void poll()
  }

  async function confirmCancel(reason: string) {
    if (!cancelling) return
    setCancelSubmitting(true)
    setCancelError(null)
    const { error } = await supabase.rpc('cancel_order', { p_order_id: cancelling.id, p_reason: reason })
    setCancelSubmitting(false)
    if (error) return setCancelError(error.message)
    toast(`Order #${cancelling.short_code} cancelled.`)
    setCancelling(null)
    void poll()
  }

  async function toggleReserve(t: FloorTable) {
    const to = t.status === 'reserved' ? 'available' : 'reserved'
    setTables((list) => list.map((x) => (x.id === t.id ? { ...x, status: to } : x)))
    await supabase.from('cafe_tables').update({ status: to }).eq('id', t.id)
  }

  async function submitQuickAdd(
    tableId: string,
    lines: { item_id: string; qty: number; variant_id: string | null; addon_ids: string[] }[],
  ) {
    setQuickAddSubmitting(true)
    setQuickAddError(null)
    // Same canonical write path as the POS and the customer QR menu — a
    // waiter adding items tableside is not a separate order engine, just a
    // third caller of the one that already exists.
    const { error } = await supabase.rpc('staff_place_order', {
      p_cafe_id: cafeId,
      p_items: lines,
      p_order_type: 'dine_in',
      p_table_id: tableId,
    })
    setQuickAddSubmitting(false)
    if (error) return setQuickAddError(error.message)
    setQuickAdding(false)
    toast('Added to the kitchen.')
    void poll()
  }

  async function acknowledgeAttention(tableId: string) {
    setAttention((s) => { const n = new Set(s); n.delete(tableId); return n })
    await supabase.from('notifications').update({ read: true }).eq('cafe_id', cafeId).eq('table_id', tableId).eq('type', 'call_waiter')
  }

  async function retrySms(logId: string) {
    setSms((list) => list.map((l) => (l.id === logId ? { ...l, status: 'pending' } : l)))
    await fetch('/api/sms/retry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ log_id: logId }) })
    void poll()
  }

  async function moveTo(destTableId: string) {
    const session = selected ? sessionByTable.get(selected) : null
    if (!session) return
    setActionError(null)
    const destLabel = tables.find((t) => t.id === destTableId)?.label ?? destTableId
    const { error } = await supabase.rpc('move_session', { p_session_id: session.id, p_to_table_id: destTableId })
    if (error) return setActionError(error.message)
    setMoving(false)
    setSelected(destTableId)
    toast(`Moved to table ${destLabel}.`)
    void poll()
  }

  async function closeTable() {
    const session = selected ? sessionByTable.get(selected) : null
    if (!session) return
    const label = selTable?.label
    setActionError(null)
    const { error } = await supabase.rpc('close_session', { p_session_id: session.id })
    if (error) return setActionError(error.message)
    setSelected(null)
    toast(label ? `Table ${label} closed.` : 'Table closed.')
    void poll()
  }

  // Split is a UI division of the same money. Financially it is the full
  // remaining bill paid by one method, allocated across the session's unpaid
  // orders through the validated ledger — so Bills, Tables and the dashboard
  // never disagree about what's paid.
  async function recordSplit(method: 'cash' | 'card', shares: number[]) {
    const session = selected ? sessionByTable.get(selected) : null
    if (!session) return
    const total = shares.reduce((a, b) => a + b, 0)
    const { error } = await supabase.rpc('record_session_payment', {
      p_session_id: session.id,
      p_amount: total,
      p_method: method,
      p_split_label: `Equal split ${shares.length} ways`,
    })
    if (error) return setActionError(error.message)
    setSplitting(false)
    toast(`Split payment recorded — ${shares.length} ways.`)
    void poll()
  }

  const selTable = tables.find((t) => t.id === selected) ?? null
  const selSession = selected ? sessionByTable.get(selected) : null
  const selOrders = selSession ? (ordersBySession.get(selSession.id) ?? []) : []
  const selTotal = selOrders.reduce((s, o) => s + o.total, 0)
  // paidBySession already counts both session-level and order-level payments,
  // so this is the whole running-bill paid amount — clamped so it can never
  // show more paid than the bill.
  const selPaid = selSession ? Math.min(selTotal, paidBySession.get(selSession.id) ?? 0) : 0
  const selRemaining = Math.max(0, selTotal - selPaid)
  const allCompleted = selOrders.length > 0 && selOrders.every((o) => o.status === 'completed')

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Tables</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live floor view — {sessions.length} of {tables.length} occupied
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!pollError && lastPollAt && (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-success">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> Live
            </span>
          )}
          <Link href="/dashboard/tables/manage" className="flex min-h-11 items-center rounded-[var(--radius)] border border-border-strong bg-surface px-4 text-sm text-foreground hover:bg-surface-subtle">
            Manage tables &amp; QR
          </Link>
        </div>
      </div>

      {pollError && (
        <p className="mt-4 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">
          Live updates failing: {pollError} — orders may not appear until this is resolved.
        </p>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {sorted.map((t) => {
          const session = sessionByTable.get(t.id)
          const active = session ? (ordersBySession.get(session.id) ?? []) : []
          const bill = active.reduce((s, o) => s + o.total, 0)
          const itemCount = items.filter((i) => active.some((o) => o.id === i.order_id)).reduce((s, i) => s + i.qty, 0)
          const billRequested = session?.status === 'bill_requested'
          const flagged = attention.has(t.id)
          const reserved = !session && t.status === 'reserved'
          const ps = session ? payStateByTable.get(t.id) : undefined

          // Base tint follows PAYMENT state (green paid / amber part / red
          // due). Operational states (waiter called, bill requested) ride on
          // top as badges + text, so status never lives in colour alone.
          let border = 'border-border bg-surface hover:border-border-strong'
          if (reserved) border = 'border-warning bg-warning-subtle'
          else if (session) {
            border = ps?.state === 'paid' ? 'border-success bg-success-subtle'
              : ps?.state === 'partial' ? 'border-warning bg-warning-subtle'
              : 'border-destructive bg-destructive-subtle'
          }

          const payBadge = ps && (
            <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
              ps.state === 'paid' ? 'bg-success text-white' : ps.state === 'partial' ? 'bg-warning text-white' : 'bg-destructive text-white'
            }`}>
              <span className="h-1 w-1 rounded-full bg-white/90" />
              {ps.state === 'paid' ? 'PAID' : ps.state === 'partial' ? 'PARTIAL' : 'DUE'}
            </span>
          )

          return (
            <button key={t.id} onClick={() => setSelected(t.id)} className={`rounded-xl border-2 p-4 text-left transition-colors ${border}`}>
              <div className="flex items-start justify-between gap-2">
                <span className="text-lg font-semibold text-foreground">{t.label}</span>
                {session ? payBadge : t.capacity ? <span className="text-[12px] text-muted-foreground">{t.capacity} seats</span> : null}
              </div>
              {session ? (
                <div className="mt-2 space-y-0.5">
                  <p className="text-[15px] font-semibold text-foreground">
                    ₹{bill}{ps && ps.state !== 'paid' && ps.due > 0 && <span className="text-[12px] font-medium text-destructive"> · ₹{ps.due} due</span>}
                  </p>
                  <p className="text-[12px] text-muted-foreground">
                    {itemCount} item{itemCount === 1 ? '' : 's'} · {active.length > 1 ? `${active.length} orders · ` : ''}
                    {mins(session.started_at)}m
                  </p>
                  {(flagged || billRequested) && (
                    <p className={`text-[12px] font-medium ${flagged ? 'text-destructive' : 'text-[#7C3AED]'}`}>
                      {flagged ? '● Waiter called' : '● Bill requested'}
                    </p>
                  )}
                </div>
              ) : (
                <p className={`mt-2 text-[13px] font-medium ${reserved ? 'text-warning' : 'text-muted-foreground'}`}>
                  {reserved ? 'Reserved' : 'Available'}
                </p>
              )}
            </button>
          )
        })}
      </div>

      {tables.length === 0 && (
        <div className="mt-8 rounded-xl border border-border bg-surface p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No tables yet. <Link href="/dashboard/tables/manage" className="text-primary hover:underline">Add tables</Link> to see your floor.
          </p>
        </div>
      )}

      {/* Table drawer */}
      {selTable && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 sm:items-stretch sm:justify-end" onClick={() => { setSelected(null); setMoving(false); setSplitting(false); setActionError(null) }}>
          <div className="max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl bg-surface p-5 sm:max-h-none sm:w-[440px] sm:rounded-none" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold text-foreground">Table {selTable.label}</h2>
                <p className="text-[13px] text-muted-foreground">
                  {selSession
                    ? `${selOrders.length} active order${selOrders.length === 1 ? '' : 's'} · bill ₹${selTotal}${selPaid > 0 ? ` · ₹${selPaid} paid` : ''}`
                    : selTable.status === 'reserved' ? 'Reserved' : 'Available'}
                </p>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Close" className="grid h-11 w-11 shrink-0 place-items-center text-xl text-muted-foreground">×</button>
            </div>

            {attention.has(selTable.id) && (
              <div className="mt-3 flex items-center justify-between rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">
                <span>Assistance requested</span>
                <button onClick={() => acknowledgeAttention(selTable.id)} className="min-h-11 px-2 font-medium hover:underline">Acknowledge</button>
              </div>
            )}

            {actionError && (
              <p className="mt-3 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">{actionError}</p>
            )}

            {!selSession && (
              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={() => { setQuickAddError(null); setQuickAdding(true) }} className="min-h-11 flex-1 rounded-[var(--radius)] bg-primary text-sm font-medium text-primary-foreground hover:bg-primary-hover">
                  Take order
                </button>
                <button onClick={() => toggleReserve(selTable)} className="min-h-11 flex-1 rounded-[var(--radius)] border border-border-strong text-sm font-medium text-foreground hover:bg-surface-subtle">
                  {selTable.status === 'reserved' ? 'Remove reservation' : 'Mark reserved'}
                </button>
              </div>
            )}

            {selSession && (
              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={() => { setQuickAddError(null); setQuickAdding(true) }} className="min-h-11 flex-1 rounded-[var(--radius)] bg-primary text-[13px] font-medium text-primary-foreground hover:bg-primary-hover">
                  Add items
                </button>
                <button onClick={() => setMoving((v) => !v)} className="min-h-11 flex-1 rounded-[var(--radius)] border border-border-strong text-[13px] font-medium text-foreground hover:bg-surface-subtle">
                  Move table
                </button>
                <button onClick={() => setSplitting((v) => !v)} className="min-h-11 flex-1 rounded-[var(--radius)] border border-border-strong text-[13px] font-medium text-foreground hover:bg-surface-subtle">
                  Split bill
                </button>
              </div>
            )}

            {moving && (
              <div className="mt-3 rounded-[var(--radius)] border border-border p-3">
                <p className="text-[13px] font-medium text-foreground">Move to which table?</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {emptyTables.length === 0 && <p className="text-[13px] text-muted-foreground">No empty tables right now.</p>}
                  {emptyTables.map((t) => (
                    <button key={t.id} onClick={() => moveTo(t.id)} className="min-h-11 rounded-full border border-border-strong px-4 text-[13px] text-foreground hover:bg-surface-subtle">
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {splitting && (
              <div className="mt-3 rounded-[var(--radius)] border border-border p-3">
                <p className="text-[13px] font-medium text-foreground">Equal split — remaining ₹{selRemaining}</p>
                <div className="mt-2 flex items-center gap-2">
                  <button onClick={() => setSplitN((n) => Math.max(2, n - 1))} aria-label="Fewer people" className="h-11 w-11 shrink-0 rounded-[var(--radius)] border border-border-strong text-lg text-foreground">−</button>
                  <span className="min-w-11 flex-1 text-center text-sm text-foreground">{splitN} people</span>
                  <button onClick={() => setSplitN((n) => Math.min(12, n + 1))} aria-label="More people" className="h-11 w-11 shrink-0 rounded-[var(--radius)] border border-border-strong text-lg text-foreground">+</button>
                </div>
                {(() => {
                  const base = Math.floor(selRemaining / splitN)
                  const remainder = selRemaining - base * splitN
                  const shares = Array.from({ length: splitN }, (_, i) => base + (i < remainder ? 1 : 0))
                  return (
                    <>
                      <p className="mt-2 text-[13px] text-muted-foreground">{shares.map((s) => `₹${s}`).join(' + ')} = ₹{shares.reduce((a, b) => a + b, 0)}</p>
                      <div className="mt-2 flex gap-2">
                        <button onClick={() => recordSplit('cash', shares)} className="min-h-11 flex-1 rounded-[var(--radius)] bg-primary text-[13px] font-medium text-primary-foreground">Record — cash</button>
                        <button onClick={() => recordSplit('card', shares)} className="min-h-11 flex-1 rounded-[var(--radius)] bg-primary text-[13px] font-medium text-primary-foreground">Record — card</button>
                      </div>
                    </>
                  )
                })()}
              </div>
            )}

            {selOrders.map((o) => {
              const its = items.filter((i) => i.order_id === o.id)
              const orderPaid = paidByOrder.get(o.id) ?? 0
              const orderDue = Math.max(0, o.total - orderPaid)
              const fullyPaid = o.total > 0 && orderDue <= 0
              const busy = payingOrder === o.id
              return (
                <section key={o.id} className="mt-4 rounded-xl border border-border p-4">
                  <div className="flex items-baseline justify-between">
                    <span className="font-semibold text-foreground">Order #{o.short_code}</span>
                    <span className="text-[12px] text-muted-foreground">{mins(o.created_at)}m ago</span>
                  </div>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">
                    <span className="capitalize">{o.status}</span>
                    {' · '}
                    {fullyPaid
                      ? <span className="font-medium text-success">Paid</span>
                      : orderPaid > 0
                        ? <span className="font-medium text-warning">Partially paid · ₹{orderDue} due</span>
                        : <span className="font-medium text-destructive">Payment due · ₹{orderDue}</span>}
                    {(names[o.customer_id ?? ''] || o.phone) && <> · {names[o.customer_id ?? ''] ?? ''} {mask(o.phone)}</>}
                  </p>
                  <ul className="mt-3 space-y-1.5 border-y border-border py-3">
                    {its.map((i) => (
                      <li key={i.id} className="flex justify-between gap-3 text-sm">
                        <div className="min-w-0">
                          <p className="text-foreground">{i.qty} × {i.name}</p>
                          {i.modifiers && i.modifiers.length > 0 && <p className="text-[12px] text-muted-foreground">{i.modifiers.map((m) => m.name).join(', ')}</p>}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-base font-semibold text-foreground">₹{o.total}</span>
                    <a href={`/r/${o.receipt_token}`} target="_blank" className="text-[13px] text-primary hover:underline">View bill →</a>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {!fullyPaid && (
                      <>
                        <button onClick={() => markPaid(o, 'cash')} disabled={busy} className="min-h-11 flex-1 rounded-[var(--radius)] border border-border-strong text-[13px] font-medium text-foreground hover:bg-surface-subtle disabled:opacity-50">Cash</button>
                        <button onClick={() => markPaid(o, 'card')} disabled={busy} className="min-h-11 flex-1 rounded-[var(--radius)] border border-border-strong text-[13px] font-medium text-foreground hover:bg-surface-subtle disabled:opacity-50">Card</button>
                        <button onClick={() => markPaid(o, 'upi')} disabled={busy} className="min-h-11 flex-1 rounded-[var(--radius)] border border-border-strong text-[13px] font-medium text-foreground hover:bg-surface-subtle disabled:opacity-50">UPI</button>
                      </>
                    )}
                    {NEXT[o.status] && (
                      <button onClick={() => advance(o)} className="min-h-11 flex-1 rounded-[var(--radius)] bg-primary text-[13px] font-medium text-primary-foreground">{NEXT[o.status].label}</button>
                    )}
                  </div>
                  <div className="mt-2 flex gap-2">
                    {o.status !== 'completed' && (
                      <button
                        onClick={() => { setCancelError(null); setCancelling(o) }}
                        className="min-h-9 flex-1 rounded-[var(--radius)] border border-border-strong text-[12.5px] font-medium text-muted-foreground hover:border-destructive hover:text-destructive"
                      >
                        Cancel order
                      </button>
                    )}
                    {/* Refund replaces Cancel once money has been taken —
                        cancel_order deliberately refuses paid orders. */}
                    {o.payment_status === 'paid' && (
                      <button
                        onClick={() => openRefund(o)}
                        className="min-h-9 flex-1 rounded-[var(--radius)] border border-border-strong text-[12.5px] font-medium text-muted-foreground hover:border-destructive hover:text-destructive"
                      >
                        Refund
                      </button>
                    )}
                    {o.payment_status === 'refunded' && (
                      <span className="min-h-9 flex-1 rounded-[var(--radius)] bg-surface-subtle text-center text-[12.5px] font-medium leading-9 text-muted-foreground">
                        Refunded
                      </span>
                    )}
                  </div>
                </section>
              )
            })}

            {selSession && (
              <button
                onClick={closeTable}
                disabled={!allCompleted}
                className="mt-4 w-full rounded-[var(--radius)] bg-foreground py-3 text-sm font-medium text-background disabled:opacity-40"
              >
                {allCompleted ? 'Close table' : 'Complete all orders to close table'}
              </button>
            )}

            {doneOrders.length > 0 && (
              <div className="mt-6">
                <p className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">Earlier today</p>
                <ul className="mt-2 space-y-2">
                  {doneOrders.map((o) => {
                    const log = sms.find((l) => l.order_id === o.id)
                    return (
                      <li key={o.id} className="rounded-lg border border-border p-3 text-[13px]">
                        <div className="flex justify-between">
                          <span className="text-foreground">#{o.short_code} · ₹{o.total}</span>
                          <a href={`/r/${o.receipt_token}`} target="_blank" className="text-primary hover:underline">Bill</a>
                        </div>
                        {log && (
                          <div className="mt-1.5 flex items-center justify-between text-[12px]">
                            <span className={log.status === 'sent' || log.status === 'delivered' ? 'text-success' : log.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}>
                              SMS bill: {log.status}{log.status === 'failed' && log.error ? ` — ${log.error.slice(0, 60)}` : ''}
                            </span>
                            {(log.status === 'failed' || log.status === 'pending') && (
                              <button onClick={() => retrySms(log.id)} className="text-primary hover:underline">Retry</button>
                            )}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {refunding && refundContext && (
        <RefundDialog
          orderLabel={`#${refunding.short_code}`}
          orderTotal={refunding.total}
          orderSubtotal={refundContext.subtotal}
          alreadyRefunded={refundContext.alreadyRefunded}
          items={refundContext.items}
          defaultMethod={refunding.payment_method}
          submitting={refundSubmitting}
          error={refundError}
          onClose={() => { setRefunding(null); setRefundContext(null) }}
          onConfirm={confirmRefund}
        />
      )}

      {cancelling && (
        <CancelOrderDialog
          orderLabel={`#${cancelling.short_code}`}
          submitting={cancelSubmitting}
          error={cancelError}
          onClose={() => setCancelling(null)}
          onConfirm={confirmCancel}
        />
      )}

      {quickAdding && selTable && (
        <QuickAddSheet
          tableLabel={selTable.label}
          categories={menu.categories}
          items={menu.items}
          variants={menu.variants}
          addons={menu.addons}
          submitting={quickAddSubmitting}
          error={quickAddError}
          onClose={() => setQuickAdding(false)}
          onSubmit={(lines) => submitQuickAdd(selTable.id, lines)}
        />
      )}
    </div>
  )
}
