'use client'

import { useCallback, useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { businessDayStartISO, businessDaysAgoStartISO, formatDateTime } from '@/lib/datetime'
import { BillDetailDrawer } from './bill-detail-drawer'

export type Bill = {
  id: string
  gst_invoice_number: string | null
  short_code: string
  created_at: string
  order_type: 'dine_in' | 'takeaway' | 'delivery'
  table_label: string | null
  customer_name: string | null
  phone: string | null
  total: number
  paid: number
  refunded: number
  payment_method: string | null
  staff_name: string | null
  receipt_token: string
  bill_status: 'OPEN' | 'PAYMENT_PENDING' | 'PAID' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'CANCELLED'
}

export type BillsPayload = {
  summary: { count: number; billed: number; paid: number; pending: number; refunded: number }
  bills: Bill[]
}

type Range = 'today' | 'yesterday' | '7d' | '30d' | 'custom'

const STATUS_STYLE: Record<Bill['bill_status'], string> = {
  PAID: 'border-success bg-success-subtle text-success',
  OPEN: 'border-border-strong bg-surface-subtle text-muted-foreground',
  PAYMENT_PENDING: 'border-warning bg-warning-subtle text-warning',
  PARTIALLY_REFUNDED: 'border-warning bg-warning-subtle text-warning',
  REFUNDED: 'border-destructive bg-destructive-subtle text-destructive',
  CANCELLED: 'border-destructive bg-destructive-subtle text-destructive',
}
const STATUS_LABEL: Record<Bill['bill_status'], string> = {
  PAID: 'Paid',
  OPEN: 'Open',
  PAYMENT_PENDING: 'Payment pending',
  PARTIALLY_REFUNDED: 'Partly refunded',
  REFUNDED: 'Refunded',
  CANCELLED: 'Cancelled',
}
const METHOD_LABEL: Record<string, string> = { cash: 'Cash', card: 'Card', upi: 'UPI', counter: 'At counter', split: 'Split' }

const money = (n: number) => `₹${n.toLocaleString('en-IN')}`
const mask = (p: string | null) => (p ? `••••${p.slice(-4)}` : null)

export default function BillsClient({
  cafeId,
  timezone,
  role,
  initial,
  initialType,
  initialRange,
}: {
  cafeId: string
  timezone: string
  role: string
  initial: BillsPayload | null
  initialType: 'all' | 'dine_in' | 'takeaway'
  initialRange: Range
}) {
  const supabase = useMemo(() => createClient(), [])
  const [payload, setPayload] = useState<BillsPayload | null>(initial)
  const [type, setType] = useState(initialType)
  const [range, setRange] = useState<Range>(initialRange)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openBill, setOpenBill] = useState<string | null>(null)

  const bounds = useCallback(
    (r: Range): { from: string; to: string } => {
      const now = new Date(Date.now() + 60_000).toISOString()
      if (r === 'yesterday') return { from: businessDaysAgoStartISO(1, timezone), to: businessDayStartISO(timezone) }
      if (r === '7d') return { from: businessDaysAgoStartISO(6, timezone), to: now }
      if (r === '30d') return { from: businessDaysAgoStartISO(29, timezone), to: now }
      if (r === 'custom' && customFrom && customTo) {
        return {
          from: businessDayStartISO(timezone, new Date(`${customFrom}T12:00:00Z`)),
          to: businessDayStartISO(timezone, new Date(new Date(`${customTo}T12:00:00Z`).getTime() + 86400000)),
        }
      }
      return { from: businessDayStartISO(timezone), to: now }
    },
    [timezone, customFrom, customTo],
  )

  const load = useCallback(
    async (r: Range, t: typeof type, q: string) => {
      setLoading(true)
      setError(null)
      const { from, to } = bounds(r)
      const { data, error: err } = await supabase.rpc('list_bills', {
        p_cafe_id: cafeId,
        p_from: from,
        p_to: to,
        p_type: t,
        p_search: q.trim() || null,
        p_limit: 200,
        p_offset: 0,
      })
      setLoading(false)
      if (err) return setError(err.message)
      setPayload(data as BillsPayload)
    },
    [supabase, cafeId, bounds],
  )

  const bills = payload?.bills ?? []
  const s = payload?.summary

  const ranges: { key: Range; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: '7d', label: '7 days' },
    { key: '30d', label: '30 days' },
    { key: 'custom', label: 'Custom' },
  ]
  const types: { key: typeof type; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'dine_in', label: 'Dine-in' },
    { key: 'takeaway', label: 'Takeaway' },
  ]

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Bills</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Every finalised bill — dine-in and takeaway together, from the same order record.
      </p>

      {s && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Metric label="Bills" value={String(s.count)} />
          <Metric label="Billed sales" value={money(s.billed)} />
          <Metric label="Collected" value={money(s.paid)} />
          <Metric label="Pending" value={money(s.pending)} tone={s.pending > 0 ? 'warning' : undefined} />
          <Metric label="Refunded" value={money(s.refunded)} tone={s.refunded > 0 ? 'destructive' : undefined} />
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        {types.map((t) => (
          <button
            key={t.key}
            onClick={() => { setType(t.key); void load(range, t.key, search) }}
            className={`min-h-9 rounded-full border px-4 text-[13px] font-medium transition-colors ${
              type === t.key ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-muted-foreground hover:bg-surface-subtle'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {ranges.map((r) => (
          <button
            key={r.key}
            onClick={() => { setRange(r.key); if (r.key !== 'custom') void load(r.key, type, search) }}
            className={`min-h-9 rounded-[var(--radius)] border px-3 text-[12.5px] font-medium transition-colors ${
              range === r.key ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-muted-foreground hover:bg-surface-subtle'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {range === 'custom' && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
            className="min-h-10 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm text-foreground" />
          <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
            className="min-h-10 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm text-foreground" />
          <button onClick={() => void load('custom', type, search)}
            className="min-h-10 rounded-[var(--radius)] bg-primary px-4 text-sm font-medium text-primary-foreground">Apply</button>
        </div>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); void load(range, type, search) }}
        className="mt-3 flex items-center gap-2"
      >
        <div className="relative min-w-0 flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Bill no., order no., table, phone or customer"
            className="min-h-10 w-full rounded-[var(--radius)] border border-border-strong bg-surface pl-9 pr-9 text-sm text-foreground"
          />
          {search && (
            <button type="button" onClick={() => { setSearch(''); void load(range, type, '') }}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center text-muted-foreground">
              <X size={14} />
            </button>
          )}
        </div>
        <button type="submit" className="min-h-10 shrink-0 rounded-[var(--radius)] border border-border-strong px-4 text-[13px] font-medium text-foreground hover:bg-surface-subtle">
          Search
        </button>
      </form>

      {error && <p className="mt-4 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">{error}</p>}

      {loading ? (
        <p className="mt-8 text-sm text-muted-foreground">Loading…</p>
      ) : bills.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">No bills in this range.</p>
      ) : (
        <>
          {/* Mobile: cards. A 10-column table squeezed onto a phone is unusable. */}
          <ul className="mt-5 space-y-2 lg:hidden">
            {bills.map((b) => (
              <li key={b.id}>
                <button onClick={() => setOpenBill(b.id)} className="w-full rounded-xl border border-border bg-surface p-4 text-left">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-medium text-foreground">
                        {b.gst_invoice_number ?? `Order #${b.short_code}`}
                      </p>
                      <p className="mt-0.5 text-[12px] text-muted-foreground">
                        #{b.short_code} · {formatDateTime(b.created_at, timezone)}
                      </p>
                    </div>
                    <span className="shrink-0 text-[15px] font-semibold text-foreground">{money(b.total)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Tag>{b.order_type === 'takeaway' ? 'Takeaway' : 'Dine-in'}</Tag>
                    {b.order_type === 'dine_in' && b.table_label && <Tag>Table {b.table_label}</Tag>}
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[b.bill_status]}`}>
                      {STATUS_LABEL[b.bill_status]}
                    </span>
                    {b.payment_method && <Tag>{METHOD_LABEL[b.payment_method] ?? b.payment_method}</Tag>}
                  </div>
                  {(b.customer_name || b.phone) && (
                    <p className="mt-1.5 text-[12px] text-muted-foreground">
                      {[b.customer_name, mask(b.phone)].filter(Boolean).join(' • ')}
                    </p>
                  )}
                </button>
              </li>
            ))}
          </ul>

          {/* Desktop: dense table */}
          <div className="mt-5 hidden overflow-x-auto rounded-xl border border-border lg:block">
            <table className="w-full min-w-[900px] text-left text-[13px]">
              <thead className="bg-surface-subtle text-[12px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Bill no.</th>
                  <th className="px-3 py-2.5 font-medium">Order</th>
                  <th className="px-3 py-2.5 font-medium">Date &amp; time</th>
                  <th className="px-3 py-2.5 font-medium">Type</th>
                  <th className="px-3 py-2.5 font-medium">Table</th>
                  <th className="px-3 py-2.5 font-medium">Customer</th>
                  <th className="px-3 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Method</th>
                  <th className="px-3 py-2.5 font-medium">Staff</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-surface">
                {bills.map((b) => (
                  <tr key={b.id} className="hover:bg-surface-subtle">
                    <td className="px-3 py-2.5 font-medium text-foreground">{b.gst_invoice_number ?? '—'}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">#{b.short_code}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{formatDateTime(b.created_at, timezone)}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{b.order_type === 'takeaway' ? 'Takeaway' : 'Dine-in'}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {b.order_type === 'takeaway' ? <span className="text-muted-foreground">—</span> : (b.table_label ?? '—')}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {[b.customer_name, mask(b.phone)].filter(Boolean).join(' • ') || '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium text-foreground">{money(b.total)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[b.bill_status]}`}>
                        {STATUS_LABEL[b.bill_status]}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{b.payment_method ? (METHOD_LABEL[b.payment_method] ?? b.payment_method) : '—'}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{b.staff_name ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right">
                      <button onClick={() => setOpenBill(b.id)} className="text-primary hover:underline">View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {openBill && (
        <BillDetailDrawer
          orderId={openBill}
          timezone={timezone}
          role={role}
          onClose={() => setOpenBill(null)}
          onChanged={() => void load(range, type, search)}
        />
      )}
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'warning' | 'destructive' }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3.5">
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold tracking-tight ${tone === 'destructive' ? 'text-destructive' : tone === 'warning' ? 'text-warning' : 'text-foreground'}`}>
        {value}
      </p>
    </div>
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-border-strong px-2 py-0.5 text-[11px] text-muted-foreground">{children}</span>
}
