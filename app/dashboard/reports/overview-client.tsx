'use client'

import { useCallback, useMemo, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { businessDayKey, businessDayStartISO, businessDaysAgoStartISO } from '@/lib/datetime'
import { downloadReport, type SheetSpec } from '@/lib/xlsx-export'
import { ReportsSubnav } from './_shared'

export type OverviewReport = {
  summary: {
    gross_sales: number
    discounts: number
    refunds: number
    net_sales: number
    tax: number
    collected: number
    outstanding: number
    orders: number
    aov: number
    customers: number
    cancelled_orders: number
  }
  compare: { from: string; to: string; net_sales: number; orders: number; refunds: number }
  by_type: { type: string; gross_sales: number; orders: number }[]
  by_source: { source: string; gross_sales: number; orders: number }[]
  by_payment_method: { method: string; amount: number }[]
  by_day: { date: string; net_sales: number; orders: number }[]
  by_hour: { hour: number; sales: number; orders: number }[]
  top_items: { name: string; qty: number; gross_sales: number }[]
  top_categories: { category: string; gross_sales: number }[]
  top_customers: { name: string; phone_masked: string; orders: number; spend: number }[]
  attention: { outstanding_amount: number; refunds_amount: number; cancelled_orders: number; low_stock_count: number }
}

type Preset = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'custom'

const TYPE_LABEL: Record<string, string> = { dine_in: 'Dine-In', takeaway: 'Takeaway' }
const SOURCE_LABEL: Record<string, string> = { qr: 'QR (customer)', pos: 'POS (staff)', staff: 'Staff' }
const METHOD_LABEL: Record<string, string> = { cash: 'Cash', card: 'Card', counter: 'Pay at counter', upi: 'UPI', split: 'Split' }

function rangeFor(preset: Preset, timezone: string): { from: string; to: string } {
  const now = new Date()
  if (preset === 'today') return { from: businessDayStartISO(timezone), to: now.toISOString() }
  if (preset === 'yesterday') {
    const from = businessDaysAgoStartISO(1, timezone)
    return { from, to: businessDayStartISO(timezone) }
  }
  if (preset === '30d') return { from: businessDaysAgoStartISO(29, timezone), to: now.toISOString() }
  if (preset === 'month') {
    const key = businessDayKey(now, timezone)
    const monthStart = new Date(`${key.slice(0, 7)}-01T12:00:00Z`)
    return { from: businessDayStartISO(timezone, monthStart), to: now.toISOString() }
  }
  return { from: businessDaysAgoStartISO(6, timezone), to: now.toISOString() }
}

// A decrease isn't always bad (refunds going down is good) — the caller says
// which direction is favourable, this just renders the right colour/arrow.
function Change({ current, previous, higherIsBetter = true }: { current: number; previous: number; higherIsBetter?: boolean }) {
  if (previous === 0) return current === 0 ? null : <span className="text-[12px] text-muted-foreground">new</span>
  const pct = Math.round(((current - previous) / Math.abs(previous)) * 100)
  if (pct === 0) return <span className="text-[12px] text-muted-foreground">flat</span>
  const up = pct > 0
  const good = up === higherIsBetter
  return (
    <span className={`text-[12px] font-medium ${good ? 'text-success' : 'text-destructive'}`}>
      {up ? '↑' : '↓'} {Math.abs(pct)}%
    </span>
  )
}

export default function OverviewClient({
  cafeId,
  cafeName,
  role,
  timezone,
  initialFrom,
  initialTo,
  initialReport,
}: {
  cafeId: string
  cafeName: string
  role: string
  timezone: string
  initialFrom: string
  initialTo: string
  initialReport: OverviewReport | null
  todayStart: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const canSeeProfit = role === 'owner' || role === 'manager'
  const [preset, setPreset] = useState<Preset>('7d')
  const [customFrom, setCustomFrom] = useState(businessDayKey(initialFrom, timezone))
  const [customTo, setCustomTo] = useState(businessDayKey(initialTo, timezone))
  const [report, setReport] = useState<OverviewReport | null>(initialReport)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (from: string, to: string) => {
      setLoading(true)
      setError(null)
      const { data, error: err } = await supabase.rpc('business_overview_report', { p_cafe_id: cafeId, p_from: from, p_to: to })
      setLoading(false)
      if (err) return setError(err.message)
      setReport(data as OverviewReport)
    },
    [supabase, cafeId],
  )

  function choosePreset(p: Preset) {
    setPreset(p)
    if (p === 'custom') return
    const { from, to } = rangeFor(p, timezone)
    void load(from, to)
  }

  function applyCustom() {
    if (!customFrom || !customTo) return
    const from = businessDayStartISO(timezone, new Date(`${customFrom}T12:00:00Z`))
    const toNextDay = new Date(new Date(`${customTo}T12:00:00Z`).getTime() + 86400_000)
    const to = businessDayStartISO(timezone, toNextDay)
    void load(from, to)
  }

  function activeRange(): { from: string; to: string } {
    if (preset === 'custom' && customFrom && customTo) {
      const from = businessDayStartISO(timezone, new Date(`${customFrom}T12:00:00Z`))
      const to = businessDayStartISO(timezone, new Date(new Date(`${customTo}T12:00:00Z`).getTime() + 86400_000))
      return { from, to }
    }
    return rangeFor(preset, timezone)
  }

  function exportExcel() {
    if (!report) return
    const { from, to } = activeRange()
    const r = report
    const sheets: SheetSpec[] = [
      {
        name: 'Executive Summary', title: 'Business overview',
        columns: [{ header: 'Metric', key: 'k', kind: 'text' }, { header: 'Value', key: 'v', kind: 'money' }],
        rows: [
          { k: 'Gross Sales', v: r.summary.gross_sales },
          { k: 'Discounts', v: r.summary.discounts },
          { k: 'Refunds', v: r.summary.refunds },
          { k: 'Net Sales', v: r.summary.net_sales },
          { k: 'Tax', v: r.summary.tax },
          { k: 'Collected', v: r.summary.collected },
          { k: 'Outstanding', v: r.summary.outstanding },
          { k: 'Orders', v: r.summary.orders },
          { k: 'Average Order Value', v: r.summary.aov },
          { k: 'Customers', v: r.summary.customers },
          { k: 'Cancelled Orders', v: r.summary.cancelled_orders },
        ],
      },
      {
        name: 'Items', title: 'Top items (gross sales)',
        columns: [{ header: 'Item', key: 'name', kind: 'text' }, { header: 'Qty', key: 'qty', kind: 'qty' }, { header: 'Gross Sales (₹)', key: 'gross_sales', kind: 'money' }],
        rows: r.top_items,
      },
      {
        name: 'Categories', title: 'Top categories (gross sales)',
        columns: [{ header: 'Category', key: 'category', kind: 'text' }, { header: 'Gross Sales (₹)', key: 'gross_sales', kind: 'money' }],
        rows: r.top_categories,
      },
      {
        name: 'Payments', title: 'Collected by payment method',
        columns: [{ header: 'Method', key: 'method', kind: 'text' }, { header: 'Amount (₹)', key: 'amount', kind: 'money' }],
        rows: r.by_payment_method.map((m) => ({ method: METHOD_LABEL[m.method] ?? m.method, amount: m.amount })),
      },
      {
        name: 'By day', title: 'Net sales by day',
        columns: [{ header: 'Date', key: 'date', kind: 'text' }, { header: 'Orders', key: 'orders', kind: 'qty' }, { header: 'Net Sales (₹)', key: 'net_sales', kind: 'money' }],
        rows: r.by_day,
      },
      {
        name: 'Customers', title: 'Top customers',
        columns: [{ header: 'Name', key: 'name', kind: 'text' }, { header: 'Phone', key: 'phone_masked', kind: 'text' }, { header: 'Orders', key: 'orders', kind: 'qty' }, { header: 'Spend (₹)', key: 'spend', kind: 'money' }],
        rows: r.top_customers,
      },
    ]
    downloadReport({ cafeName, reportName: 'Business-Overview', from, to }, sheets)
  }

  const maxDayNet = Math.max(1, ...(report?.by_day.map((d) => d.net_sales) ?? [0]))
  const maxHourSales = Math.max(1, ...(report?.by_hour.map((h) => h.sales) ?? [0]))

  const presets: { key: Preset; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: '7d', label: 'Last 7 days' },
    { key: '30d', label: 'Last 30 days' },
    { key: 'month', label: 'This month' },
    { key: 'custom', label: 'Custom' },
  ]

  const attentionItems = report
    ? [
        report.attention.outstanding_amount > 0 && `₹${report.attention.outstanding_amount.toLocaleString('en-IN')} outstanding`,
        report.attention.low_stock_count > 0 && `${report.attention.low_stock_count} low-stock ingredient${report.attention.low_stock_count === 1 ? '' : 's'}`,
        report.attention.refunds_amount > 0 && `₹${report.attention.refunds_amount.toLocaleString('en-IN')} refunded`,
        report.attention.cancelled_orders > 0 && `${report.attention.cancelled_orders} cancelled order${report.attention.cancelled_orders === 1 ? '' : 's'}`,
      ].filter((x): x is string => Boolean(x))
    : []

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <ReportsSubnav active="/dashboard/reports" canSeeProfit={canSeeProfit} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">Overview — how much you sold, collected, and where money went, in this range.</p>
        </div>
        <button onClick={exportExcel} disabled={!report} className="min-h-10 rounded-[var(--radius)] bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-40">
          Export Excel
        </button>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {presets.map((p) => (
          <button
            key={p.key}
            onClick={() => choosePreset(p.key)}
            className={`min-h-9 rounded-[var(--radius)] border px-3 text-[13px] font-medium transition-colors ${
              preset === p.key ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-muted-foreground hover:bg-surface-subtle'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {preset === 'custom' && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-[13px] text-foreground">
            <span className="block text-muted-foreground">From</span>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
              className="min-h-10 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm text-foreground" />
          </label>
          <label className="space-y-1 text-[13px] text-foreground">
            <span className="block text-muted-foreground">To</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
              className="min-h-10 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm text-foreground" />
          </label>
          <button onClick={applyCustom} className="min-h-10 rounded-[var(--radius)] bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
            Apply
          </button>
        </div>
      )}

      {error && <p className="mt-4 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">{error}</p>}

      {loading ? (
        <p className="mt-8 text-sm text-muted-foreground">Loading…</p>
      ) : !report ? (
        <p className="mt-8 text-sm text-muted-foreground">No data for this range.</p>
      ) : (
        <>
          {/* Headline KPIs with vs-previous-period comparison */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[12.5px] text-muted-foreground">Net Sales</p>
              <p className="mt-1 text-xl font-semibold tracking-tight text-foreground">₹{report.summary.net_sales.toLocaleString('en-IN')}</p>
              <Change current={report.summary.net_sales} previous={report.compare.net_sales} />
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[12.5px] text-muted-foreground">Orders</p>
              <p className="mt-1 text-xl font-semibold tracking-tight text-foreground">{report.summary.orders}</p>
              <Change current={report.summary.orders} previous={report.compare.orders} />
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[12.5px] text-muted-foreground">Average Order Value</p>
              <p className="mt-1 text-xl font-semibold tracking-tight text-foreground">₹{report.summary.aov}</p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[12.5px] text-muted-foreground">Customers</p>
              <p className="mt-1 text-xl font-semibold tracking-tight text-foreground">{report.summary.customers}</p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[12.5px] text-muted-foreground">Collected</p>
              <p className="mt-1 text-xl font-semibold tracking-tight text-success">₹{report.summary.collected.toLocaleString('en-IN')}</p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[12.5px] text-muted-foreground">Outstanding</p>
              <p className={`mt-1 text-xl font-semibold tracking-tight ${report.summary.outstanding > 0 ? 'text-destructive' : 'text-foreground'}`}>
                ₹{report.summary.outstanding.toLocaleString('en-IN')}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[12.5px] text-muted-foreground">Refunds</p>
              <p className="mt-1 text-xl font-semibold tracking-tight text-foreground">₹{report.summary.refunds.toLocaleString('en-IN')}</p>
              <Change current={report.summary.refunds} previous={report.compare.refunds} higherIsBetter={false} />
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[12.5px] text-muted-foreground">Tax</p>
              <p className="mt-1 text-xl font-semibold tracking-tight text-foreground">₹{report.summary.tax.toLocaleString('en-IN')}</p>
            </div>
          </div>

          {/* Waterfall */}
          <Section title="Gross Sales → Net Sales">
            <ul className="space-y-1.5 text-sm">
              <Row label="Gross Sales" value={report.summary.gross_sales} />
              <Row label="Discounts" value={-report.summary.discounts} />
              <Row label="Refunds" value={-report.summary.refunds} />
              <li className="my-1 h-px bg-border" />
              <Row label="Net Sales" value={report.summary.net_sales} bold />
            </ul>
          </Section>

          {attentionItems.length > 0 && (
            <Section title="Needs Attention">
              <ul className="space-y-1.5 text-sm text-foreground">
                {attentionItems.map((t, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" /> {t}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {report.by_hour.some((h) => h.sales > 0) && (
            <Section title="Peak hours">
              <div className="flex items-end gap-1 overflow-x-auto pb-1" style={{ height: 130 }}>
                {report.by_hour.map((h) => (
                  <div key={h.hour} className="flex min-w-[20px] flex-1 flex-col items-center justify-end gap-1" title={`${h.hour}:00 — ₹${h.sales} (${h.orders} orders)`}>
                    <div className="w-full rounded-t bg-primary" style={{ height: `${Math.max(3, (h.sales / maxHourSales) * 100)}px` }} />
                    <span className="whitespace-nowrap text-[9.5px] text-muted-foreground">{h.hour}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {report.by_day.length > 0 && (
            <Section title="Net sales by day">
              <div className="flex items-end gap-1.5 overflow-x-auto pb-1" style={{ height: 140 }}>
                {report.by_day.map((d) => (
                  <div key={d.date} className="flex min-w-[28px] flex-1 flex-col items-center justify-end gap-1" title={`${d.date}: ₹${d.net_sales} (${d.orders} orders)`}>
                    <div className="w-full rounded-t bg-primary" style={{ height: `${Math.max(4, (d.net_sales / maxDayNet) * 110)}px` }} />
                    <span className="whitespace-nowrap text-[10px] text-muted-foreground">{d.date.slice(5)}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            {report.by_type.length > 0 && (
              <Section title="Dine-in vs Takeaway">
                <List rows={report.by_type.map((t) => ({ label: `${TYPE_LABEL[t.type] ?? t.type} (${t.orders})`, value: t.gross_sales }))} />
              </Section>
            )}
            {report.by_source.length > 0 && (
              <Section title="By order source">
                <List rows={report.by_source.map((s) => ({ label: `${SOURCE_LABEL[s.source] ?? s.source} (${s.orders})`, value: s.gross_sales }))} />
              </Section>
            )}
            {report.by_payment_method.length > 0 && (
              <Section title="Payment mix (collected)">
                <List rows={report.by_payment_method.map((m) => ({ label: METHOD_LABEL[m.method] ?? m.method, value: m.amount }))} />
              </Section>
            )}
            {report.top_items.length > 0 && (
              <Section title="Top items">
                <List rows={report.top_items.map((i) => ({ label: `${i.name} × ${i.qty}`, value: i.gross_sales }))} />
              </Section>
            )}
            {report.top_categories.length > 0 && (
              <Section title="Top categories">
                <List rows={report.top_categories.map((c) => ({ label: c.category, value: c.gross_sales }))} />
              </Section>
            )}
            {report.top_customers.length > 0 && (
              <Section title="Top customers">
                <List rows={report.top_customers.map((c) => ({ label: `${c.name} (${c.orders})`, value: c.spend }))} />
              </Section>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Row({ label, value, bold = false }: { label: string; value: number; bold?: boolean }) {
  const negative = value < 0
  return (
    <li className={`flex items-center justify-between gap-3 ${bold ? 'font-semibold text-foreground' : 'text-foreground'}`}>
      <span>{label}</span>
      <span className={negative ? 'text-destructive' : ''}>
        {negative ? '-' : ''}₹{Math.abs(value).toLocaleString('en-IN')}
      </span>
    </li>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-8 first:mt-6">
      <p className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="mt-3 rounded-xl border border-border bg-surface p-4">{children}</div>
    </div>
  )
}

function List({ rows }: { rows: { label: string; value: number }[] }) {
  return (
    <ul className="space-y-2">
      {rows.map((r, i) => (
        <li key={i} className="flex items-center justify-between gap-3 text-sm">
          <span className="min-w-0 truncate text-foreground">{r.label}</span>
          <span className="shrink-0 font-medium text-foreground">₹{r.value.toLocaleString('en-IN')}</span>
        </li>
      ))}
    </ul>
  )
}
