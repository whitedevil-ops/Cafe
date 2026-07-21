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

type ActiveOrder = {
  id: string
  table_id: string | null
  customer_id: string | null
  short_code: string
  status: 'placed' | 'accepted' | 'preparing' | 'ready' | 'served'
  payment_status: string
  payment_method: string | null
  phone: string | null
  total: number
  receipt_token: string
  created_at: string
}
type Item = { id: string; order_id: string; name: string; qty: number; modifiers: { name: string }[] | null }
type DoneOrder = Omit<ActiveOrder, 'status'> & { status: string }
type SmsLog = { id: string; order_id: string; status: string; error: string | null }

const ACTIVE = ['placed', 'accepted', 'preparing', 'ready', 'served']
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
  const [orders, setOrders] = useState<ActiveOrder[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [done, setDone] = useState<DoneOrder[]>([])
  const [sms, setSms] = useState<SmsLog[]>([])
  const [pollError, setPollError] = useState<string | null>(null)
  const [lastPollAt, setLastPollAt] = useState<Date | null>(null)
  const [, tick] = useState(0)
  const selectedRef = useRef<string | null>(null)
  selectedRef.current = selected

  const poll = useCallback(async () => {
    const [{ data: tbls, error: tblErr }, { data: ords, error: ordErr }] = await Promise.all([
      supabase.from('cafe_tables').select('id, label, capacity, status').eq('cafe_id', cafeId),
      supabase
        .from('orders')
        .select('id, table_id, customer_id, short_code, status, payment_status, payment_method, phone, total, receipt_token, created_at')
        .eq('cafe_id', cafeId)
        .in('status', ACTIVE)
        .order('created_at', { ascending: true }),
    ])
    // A failed poll must be VISIBLE, never a floor that quietly shows everything
    // as Available while orders pile up.
    if (tblErr || ordErr) {
      setPollError((tblErr ?? ordErr)!.message)
      return
    }
    setPollError(null)
    setLastPollAt(new Date())
    if (tbls) setTables(tbls as FloorTable[])
    if (!ords) return
    setOrders(ords as ActiveOrder[])

    if (ords.length) {
      const [{ data: its }, custRes] = await Promise.all([
        supabase.from('order_items').select('id, order_id, name, qty, modifiers').in('order_id', ords.map((o) => o.id)),
        (async () => {
          const ids = [...new Set(ords.map((o) => o.customer_id).filter(Boolean))] as string[]
          if (!ids.length) return { data: [] as { id: string; name: string | null }[] }
          return supabase.from('customers').select('id, name').in('id', ids)
        })(),
      ])
      if (its) setItems(its as Item[])
      const map: Record<string, string> = {}
      for (const c of custRes.data ?? []) if (c.name) map[c.id] = c.name
      setNames(map)
    } else {
      setItems([])
    }

    // Drawer open → also refresh that table's completed-today orders + SMS state.
    const sel = selectedRef.current
    if (sel) {
      const dayStart = new Date()
      dayStart.setHours(0, 0, 0, 0)
      const { data: doneOrds } = await supabase
        .from('orders')
        .select('id, table_id, customer_id, short_code, status, payment_status, payment_method, phone, total, receipt_token, created_at')
        .eq('cafe_id', cafeId)
        .eq('table_id', sel)
        .eq('status', 'completed')
        .gte('created_at', dayStart.toISOString())
        .order('created_at', { ascending: false })
        .limit(10)
      setDone((doneOrds ?? []) as DoneOrder[])
      if (doneOrds?.length) {
        const { data: logs } = await supabase
          .from('sms_logs')
          .select('id, order_id, status, error')
          .in('order_id', doneOrds.map((o) => o.id))
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

  const byTable = useMemo(() => {
    const m = new Map<string, ActiveOrder[]>()
    for (const o of orders) if (o.table_id) m.set(o.table_id, [...(m.get(o.table_id) ?? []), o])
    return m
  }, [orders])

  const sorted = useMemo(
    () => [...tables].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
    [tables],
  )

  async function advance(o: ActiveOrder) {
    const to = NEXT[o.status]?.to
    if (!to) return
    setOrders((list) =>
      to === 'completed'
        ? list.filter((x) => x.id !== o.id)
        : list.map((x) => (x.id === o.id ? { ...x, status: to as ActiveOrder['status'] } : x)),
    )
    await supabase
      .from('orders')
      .update({ status: to, done_at: to === 'completed' ? new Date().toISOString() : null })
      .eq('id', o.id)
    void poll()
  }

  async function markPaid(o: ActiveOrder, method: 'cash' | 'card') {
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

  async function retrySms(logId: string) {
    setSms((list) => list.map((l) => (l.id === logId ? { ...l, status: 'pending' } : l)))
    await fetch('/api/sms/retry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ log_id: logId }),
    })
    void poll()
  }

  const selTable = tables.find((t) => t.id === selected) ?? null
  const selOrders = selected ? (byTable.get(selected) ?? []) : []

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Tables</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live floor view — {byTable.size} of {tables.length} occupied
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!pollError && lastPollAt && (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-success">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> Live
            </span>
          )}
          <Link
            href="/dashboard/tables/manage"
            className="rounded-[var(--radius)] border border-border-strong bg-surface px-4 py-2 text-sm text-foreground hover:bg-surface-subtle"
          >
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
          const active = byTable.get(t.id) ?? []
          const occupied = active.length > 0
          const bill = active.reduce((s, o) => s + o.total, 0)
          const itemCount = items.filter((i) => active.some((o) => o.id === i.order_id)).reduce((s, i) => s + i.qty, 0)
          const oldest = active[0]
          const reserved = !occupied && t.status === 'reserved'
          return (
            <button
              key={t.id}
              onClick={() => setSelected(t.id)}
              className={`rounded-xl border-2 p-4 text-left transition-colors ${
                occupied
                  ? 'border-success bg-success-subtle'
                  : reserved
                    ? 'border-warning bg-warning-subtle'
                    : 'border-border bg-surface hover:border-border-strong'
              }`}
            >
              <div className="flex items-baseline justify-between">
                <span className="text-lg font-semibold text-foreground">{t.label}</span>
                {t.capacity && <span className="text-[12px] text-muted-foreground">{t.capacity} seats</span>}
              </div>
              {occupied ? (
                <div className="mt-2 space-y-0.5">
                  <p className="text-[15px] font-semibold text-success">₹{bill}</p>
                  <p className="text-[12px] text-muted-foreground">
                    {itemCount} item{itemCount === 1 ? '' : 's'} · {active.length > 1 ? `${active.length} orders · ` : ''}
                    {oldest ? `${mins(oldest.created_at)}m` : ''}
                  </p>
                  <p className="text-[12px] font-medium capitalize text-success">{active[active.length - 1].status}</p>
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
            No tables yet.{' '}
            <Link href="/dashboard/tables/manage" className="text-primary hover:underline">Add tables</Link> to see your floor.
          </p>
        </div>
      )}

      {/* Table drawer */}
      {selTable && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 sm:items-stretch sm:justify-end" onClick={() => setSelected(null)}>
          <div
            className="max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl bg-surface p-5 sm:max-h-none sm:w-[440px] sm:rounded-none"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold text-foreground">Table {selTable.label}</h2>
                <p className="text-[13px] text-muted-foreground">
                  {selOrders.length > 0
                    ? `Occupied · ${selOrders.length} active order${selOrders.length > 1 ? 's' : ''} · bill ₹${selOrders.reduce((s, o) => s + o.total, 0)}`
                    : selTable.status === 'reserved'
                      ? 'Reserved'
                      : 'Available'}
                </p>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Close" className="px-2 text-xl text-muted-foreground">×</button>
            </div>

            {selOrders.length === 0 && (
              <button
                onClick={() => toggleReserve(selTable)}
                className="mt-4 w-full rounded-[var(--radius)] border border-border-strong py-2.5 text-sm font-medium text-foreground hover:bg-surface-subtle"
              >
                {selTable.status === 'reserved' ? 'Remove reservation' : 'Mark reserved'}
              </button>
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
                    {o.payment_status === 'paid' ? (
                      <span className="font-medium text-success">Paid</span>
                    ) : (
                      'Pay at counter'
                    )}
                    {(names[o.customer_id ?? ''] || o.phone) && (
                      <> · {names[o.customer_id ?? ''] ?? ''} {mask(o.phone)}</>
                    )}
                  </p>
                  <ul className="mt-3 space-y-1.5 border-y border-border py-3">
                    {its.map((i) => (
                      <li key={i.id} className="flex justify-between gap-3 text-sm">
                        <div className="min-w-0">
                          <p className="text-foreground">{i.qty} × {i.name}</p>
                          {i.modifiers && i.modifiers.length > 0 && (
                            <p className="text-[12px] text-muted-foreground">{i.modifiers.map((m) => m.name).join(', ')}</p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-base font-semibold text-foreground">₹{o.total}</span>
                    <a href={`/r/${o.receipt_token}`} target="_blank" className="text-[13px] text-primary hover:underline">
                      View bill →
                    </a>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {o.payment_status !== 'paid' && (
                      <>
                        <button onClick={() => markPaid(o, 'cash')} className="flex-1 rounded-[var(--radius)] border border-warning py-2 text-[13px] font-medium text-warning">
                          Paid — cash
                        </button>
                        <button onClick={() => markPaid(o, 'card')} className="flex-1 rounded-[var(--radius)] border border-warning py-2 text-[13px] font-medium text-warning">
                          Paid — card
                        </button>
                      </>
                    )}
                    {NEXT[o.status] && (
                      <button onClick={() => advance(o)} className="flex-1 rounded-[var(--radius)] bg-primary py-2 text-[13px] font-medium text-primary-foreground">
                        {NEXT[o.status].label}
                      </button>
                    )}
                  </div>
                </section>
              )
            })}

            {done.length > 0 && (
              <div className="mt-6">
                <p className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">Earlier today</p>
                <ul className="mt-2 space-y-2">
                  {done.map((o) => {
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
                              SMS bill: {log.status}
                              {log.status === 'failed' && log.error ? ` — ${log.error.slice(0, 60)}` : ''}
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
