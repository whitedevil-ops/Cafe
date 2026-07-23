'use client'

import { useMemo, useState } from 'react'
import { Search, X, Star, TrendingDown, Sparkles } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import type { CustomerStat } from './page'
import { formatDayMonth } from '@/lib/datetime'

type Segment = 'all' | CustomerStat['segment']

const SEGMENT_META: Record<CustomerStat['segment'], { label: string; badge: string; icon: React.ReactNode }> = {
  new: { label: 'New', badge: 'bg-primary-subtle text-primary', icon: <Sparkles size={12} /> },
  regular: { label: 'Regular', badge: 'bg-surface-subtle text-muted-foreground', icon: null },
  vip: { label: 'VIP', badge: 'bg-warning-subtle text-warning', icon: <Star size={12} /> },
  at_risk: { label: 'At risk', badge: 'bg-destructive-subtle text-destructive', icon: <TrendingDown size={12} /> },
}

const mask = (p: string | null) => (p ? `******${p.slice(-4)}` : '—')
const fmtDate = (iso: string | null, tz: string) => (iso ? formatDayMonth(iso, tz) : 'Never')

type OrderRow = { id: string; short_code: string; total: number; status: string; created_at: string; receipt_token: string }

export default function CustomersClient({
  cafeId,
  timezone,
  initialCustomers,
  initialSegment = 'all',
}: {
  cafeId: string
  timezone: string
  initialCustomers: CustomerStat[]
  initialSegment?: Segment
}) {
  const supabase = useMemo(() => createClient(), [])
  const [search, setSearch] = useState('')
  const [segment, setSegment] = useState<Segment>(initialSegment)
  const [selected, setSelected] = useState<CustomerStat | null>(null)
  const [history, setHistory] = useState<OrderRow[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  const counts = useMemo(() => {
    const c: Record<Segment, number> = { all: initialCustomers.length, new: 0, regular: 0, vip: 0, at_risk: 0 }
    for (const cust of initialCustomers) c[cust.segment]++
    return c
  }, [initialCustomers])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return initialCustomers
      .filter((c) => (segment === 'all' ? true : c.segment === segment))
      .filter((c) => (q ? (c.name?.toLowerCase().includes(q) ?? false) || (c.phone?.includes(q) ?? false) : true))
  }, [initialCustomers, segment, search])

  async function openCustomer(c: CustomerStat) {
    setSelected(c)
    setLoadingHistory(true)
    const { data } = await supabase
      .from('orders')
      .select('id, short_code, total, status, created_at, receipt_token')
      .eq('cafe_id', cafeId)
      .eq('customer_id', c.customer_id)
      .order('created_at', { ascending: false })
      .limit(15)
    setHistory((data ?? []) as OrderRow[])
    setLoadingHistory(false)
  }

  const tabs: { key: Segment; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'new', label: 'New' },
    { key: 'regular', label: 'Regular' },
    { key: 'vip', label: 'VIP' },
    { key: 'at_risk', label: 'At risk' },
  ]

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Customers</h1>
        <p className="mt-1 text-sm text-muted-foreground">{initialCustomers.length} customers — segments are computed automatically from order history.</p>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setSegment(t.key)}
            className={`flex min-h-10 items-center gap-1.5 rounded-[var(--radius)] border px-3.5 text-[13px] font-medium transition-colors ${
              segment === t.key ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-muted-foreground hover:border-border-strong'
            }`}
          >
            {t.key !== 'all' && SEGMENT_META[t.key].icon}
            {t.label}
            <span className="opacity-60">{counts[t.key]}</span>
          </button>
        ))}
      </div>

      <div className="relative mt-4">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or phone…"
          className="h-11 w-full rounded-[var(--radius)] border border-border-strong bg-surface pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {visible.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">No customers match.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {visible.map((c) => (
            <li key={c.customer_id}>
              <button
                onClick={() => openCustomer(c)}
                className="flex w-full items-center gap-3 rounded-[var(--radius)] border border-border bg-surface p-4 text-left transition-colors hover:border-border-strong"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[14px] font-medium text-foreground">{c.name || 'Unnamed customer'}</p>
                    <span className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${SEGMENT_META[c.segment].badge}`}>
                      {SEGMENT_META[c.segment].icon}
                      {SEGMENT_META[c.segment].label}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                    {mask(c.phone)} · {c.visits} visit{c.visits === 1 ? '' : 's'} · Last {fmtDate(c.last_visit, timezone)}
                    {c.favourite_item && <> · Loves {c.favourite_item}</>}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[14px] font-semibold text-foreground">₹{c.total_spend}</p>
                  <p className="text-[11.5px] text-muted-foreground">{c.loyalty_points} pts</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={() => setSelected(null)}>
          <div
            className="flex max-h-[85dvh] w-full max-w-md flex-col rounded-t-2xl bg-surface sm:max-h-[80dvh] sm:rounded-[var(--radius-lg)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-border px-5 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-[16px] font-semibold text-foreground">{selected.name || 'Unnamed customer'}</h2>
                  <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${SEGMENT_META[selected.segment].badge}`}>
                    {SEGMENT_META[selected.segment].icon}
                    {SEGMENT_META[selected.segment].label}
                  </span>
                </div>
                <p className="mt-0.5 text-[12.5px] text-muted-foreground">{mask(selected.phone)}{selected.email ? ` · ${selected.email}` : ''}</p>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center text-muted-foreground">
                <X size={18} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ['Visits', selected.visits],
                  ['Total spend', `₹${selected.total_spend}`],
                  ['Avg. order', `₹${selected.avg_order_value}`],
                  ['Loyalty points', selected.loyalty_points],
                ].map(([label, value]) => (
                  <div key={label as string} className="rounded-[var(--radius)] bg-surface-subtle p-3">
                    <p className="text-[11px] text-muted-foreground">{label}</p>
                    <p className="mt-0.5 text-[15px] font-semibold text-foreground">{value}</p>
                  </div>
                ))}
              </div>
              {selected.favourite_item && (
                <p className="mt-3 text-[13px] text-muted-foreground">Favourite item — <span className="font-medium text-foreground">{selected.favourite_item}</span></p>
              )}

              <p className="mt-5 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">Order history</p>
              {loadingHistory ? (
                <p className="mt-2 text-[13px] text-muted-foreground">Loading…</p>
              ) : history.length === 0 ? (
                <p className="mt-2 text-[13px] text-muted-foreground">No orders yet.</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {history.map((o) => (
                    <li key={o.id} className="flex items-center justify-between rounded-[var(--radius)] border border-border px-3 py-2 text-[13px]">
                      <div className="min-w-0">
                        <p className="text-foreground">#{o.short_code} · ₹{o.total}</p>
                        <p className="text-[11.5px] capitalize text-muted-foreground">{o.status} · {fmtDate(o.created_at, timezone)}</p>
                      </div>
                      {o.status === 'completed' && (
                        <a href={`/r/${o.receipt_token}`} target="_blank" className="shrink-0 text-primary hover:underline">Bill →</a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
