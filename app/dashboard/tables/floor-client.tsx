'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'

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
  initialTables,
}: {
  cafeId: string
  initialTables: FloorTable[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const [tables, setTables] = useState(initialTables)
  const [sessions, setSessions] = useState<Session[]>([])
  const [orders, setOrders] = useState<SessionOrder[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
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
  const [, tick] = useState(0)
  const selectedRef = useRef<string | null>(null)
  selectedRef.current = selected

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

      const [{ data: its }, { data: pays }, custRes] = await Promise.all([
        orderRows.length
          ? supabase.from('order_items').select('id, order_id, name, qty, modifiers').in('order_id', orderRows.map((o) => o.id))
          : Promise.resolve({ data: [] as Item[] }),
        supabase.from('payments').select('session_id, order_id, amount').in('session_id', sessionIds),
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
      const dayStart = new Date()
      dayStart.setHours(0, 0, 0, 0)
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
  }, [supabase, cafeId])

  useEffect(() => {
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
  const paidBySession = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of payments) if (p.session_id) m.set(p.session_id, (m.get(p.session_id) ?? 0) + p.amount)
    return m
  }, [payments])

  const sorted = useMemo(
    () => [...tables].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
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

  async function markPaid(o: SessionOrder, method: 'cash' | 'card') {
    setOrders((list) => list.map((x) => (x.id === o.id ? { ...x, payment_status: 'paid' } : x)))
    const { error } = await supabase.from('payments').insert({ cafe_id: cafeId, order_id: o.id, method, amount: o.total })
    if (!error) await supabase.from('orders').update({ payment_status: 'paid', payment_method: method }).eq('id', o.id)
    void poll()
  }

  async function toggleReserve(t: FloorTable) {
    const to = t.status === 'reserved' ? 'available' : 'reserved'
    setTables((list) => list.map((x) => (x.id === t.id ? { ...x, status: to } : x)))
    await supabase.from('cafe_tables').update({ status: to }).eq('id', t.id)
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
    const { error } = await supabase.rpc('move_session', { p_session_id: session.id, p_to_table_id: destTableId })
    if (error) return setActionError(error.message)
    setMoving(false)
    setSelected(destTableId)
    void poll()
  }

  async function closeTable() {
    const session = selected ? sessionByTable.get(selected) : null
    if (!session) return
    setActionError(null)
    const { error } = await supabase.rpc('close_session', { p_session_id: session.id })
    if (error) return setActionError(error.message)
    setSelected(null)
    void poll()
  }

  async function recordSplit(method: 'cash' | 'card', shares: number[]) {
    const session = selected ? sessionByTable.get(selected) : null
    if (!session) return
    const rows = shares.map((amount, i) => ({
      cafe_id: cafeId,
      session_id: session.id,
      method,
      amount,
      split_label: `Equal split ${i + 1}/${shares.length}`,
    }))
    const { error } = await supabase.from('payments').insert(rows)
    if (error) return setActionError(error.message)
    setSplitting(false)
    void poll()
  }

  const selTable = tables.find((t) => t.id === selected) ?? null
  const selSession = selected ? sessionByTable.get(selected) : null
  const selOrders = selSession ? (ordersBySession.get(selSession.id) ?? []) : []
  const selTotal = selOrders.reduce((s, o) => s + o.total, 0)
  const selPaid = selSession ? (paidBySession.get(selSession.id) ?? 0) + selOrders.filter((o) => o.payment_status === 'paid').reduce((s, o) => s + o.total, 0) : 0
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

          let border = 'border-border bg-surface hover:border-border-strong'
          if (flagged) border = 'border-destructive bg-destructive-subtle'
          else if (billRequested) border = 'border-[#8B5CF6] bg-[#F3F0FF]'
          else if (session) border = 'border-success bg-success-subtle'
          else if (reserved) border = 'border-warning bg-warning-subtle'

          return (
            <button key={t.id} onClick={() => setSelected(t.id)} className={`rounded-xl border-2 p-4 text-left transition-colors ${border}`}>
              <div className="flex items-baseline justify-between">
                <span className="text-lg font-semibold text-foreground">{t.label}</span>
                {t.capacity && <span className="text-[12px] text-muted-foreground">{t.capacity} seats</span>}
              </div>
              {session ? (
                <div className="mt-2 space-y-0.5">
                  <p className="text-[15px] font-semibold text-foreground">₹{bill}</p>
                  <p className="text-[12px] text-muted-foreground">
                    {itemCount} item{itemCount === 1 ? '' : 's'} · {active.length > 1 ? `${active.length} orders · ` : ''}
                    {mins(session.started_at)}m
                  </p>
                  <p className="text-[12px] font-medium capitalize" style={{ color: billRequested ? '#7C3AED' : flagged ? undefined : undefined }}>
                    {flagged ? 'Needs assistance' : billRequested ? 'Bill requested' : active[active.length - 1]?.status ?? 'Occupied'}
                  </p>
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
              <button onClick={() => toggleReserve(selTable)} className="mt-4 min-h-11 w-full rounded-[var(--radius)] border border-border-strong text-sm font-medium text-foreground hover:bg-surface-subtle">
                {selTable.status === 'reserved' ? 'Remove reservation' : 'Mark reserved'}
              </button>
            )}

            {selSession && (
              <div className="mt-4 flex flex-wrap gap-2">
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
              return (
                <section key={o.id} className="mt-4 rounded-xl border border-border p-4">
                  <div className="flex items-baseline justify-between">
                    <span className="font-semibold text-foreground">Order #{o.short_code}</span>
                    <span className="text-[12px] text-muted-foreground">{mins(o.created_at)}m ago</span>
                  </div>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">
                    <span className="capitalize">{o.status}</span>
                    {' · '}
                    {o.payment_status === 'paid' ? <span className="font-medium text-success">Paid</span> : 'Pay at counter'}
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
                    {o.payment_status !== 'paid' && (
                      <>
                        <button onClick={() => markPaid(o, 'cash')} className="min-h-11 flex-1 rounded-[var(--radius)] border border-warning text-[13px] font-medium text-warning">Paid — cash</button>
                        <button onClick={() => markPaid(o, 'card')} className="min-h-11 flex-1 rounded-[var(--radius)] border border-warning text-[13px] font-medium text-warning">Paid — card</button>
                      </>
                    )}
                    {NEXT[o.status] && (
                      <button onClick={() => advance(o)} className="min-h-11 flex-1 rounded-[var(--radius)] bg-primary text-[13px] font-medium text-primary-foreground">{NEXT[o.status].label}</button>
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
    </div>
  )
}
