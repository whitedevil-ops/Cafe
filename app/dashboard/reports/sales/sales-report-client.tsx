'use client'

import { useCallback, useMemo, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { businessDayKey, businessDayStartISO, businessDaysAgoStartISO } from '@/lib/datetime'
import type { SheetSpec } from '@/lib/xlsx-export'
import { useFileExport } from '@/lib/use-file-export'
import { ReportsSubnav } from '../_shared'

export type SalesReport = {
  summary: { revenue: number; orders: number; aov: number; discount: number; tax: number; refunds: number; expenses: number | null; net_profit: number | null }
  by_day: { date: string; revenue: number; orders: number }[]
  top_items: { name: string; qty: number; revenue: number }[]
  by_category: { category: string; revenue: number }[]
  by_payment_method: { method: string; revenue: number }[]
  by_source: { source: string; orders: number; revenue: number }[]
  by_staff: { staff_name: string; orders: number; revenue: number }[]
}

type Preset = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'custom'

const METHOD_LABEL: Record<string, string> = { cash: 'Cash', card: 'Card', counter: 'Pay at counter', upi: 'UPI' }
const SOURCE_LABEL: Record<string, string> = { qr: 'QR (customer)', pos: 'POS (staff)', staff: 'Staff' }

function rangeFor(preset: Preset, timezone: string): { from: string; to: string } {
  const now = new Date()
  if (preset === 'today') {
    return { from: businessDayStartISO(timezone), to: now.toISOString() }
  }
  if (preset === 'yesterday') {
    const from = businessDaysAgoStartISO(1, timezone)
    return { from, to: businessDayStartISO(timezone) }
  }
  if (preset === '30d') {
    return { from: businessDaysAgoStartISO(29, timezone), to: now.toISOString() }
  }
  if (preset === 'month') {
    const key = businessDayKey(now, timezone) // "YYYY-MM-DD"
    const monthStart = new Date(`${key.slice(0, 7)}-01T12:00:00Z`)
    return { from: businessDayStartISO(timezone, monthStart), to: now.toISOString() }
  }
  // '7d' default
  return { from: businessDaysAgoStartISO(6, timezone), to: now.toISOString() }
}

export default function SalesReportClient({
  cafeId,
  cafeName,
  role,
  timezone,
  initialFrom,
  initialTo,
  initialReport,
  initialError,
}: {
  cafeId: string
  cafeName: string
  role: string
  timezone: string
  initialFrom: string
  initialTo: string
  initialReport: SalesReport | null
  initialError?: string | null
  todayStart: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const canSeeProfit = role === 'owner' || role === 'manager'
  const [preset, setPreset] = useState<Preset>('7d')
  const [customFrom, setCustomFrom] = useState(businessDayKey(initialFrom, timezone))
  const [customTo, setCustomTo] = useState(businessDayKey(initialTo, timezone))
  const [report, setReport] = useState<SalesReport | null>(initialReport)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(initialError ?? null)
  const { runExport, exporting } = useFileExport()

  const load = useCallback(
    async (from: string, to: string) => {
      setLoading(true)
      setError(null)
      const { data, error: err } = await supabase.rpc('sales_report', { p_cafe_id: cafeId, p_from: from, p_to: to })
      setLoading(false)
      if (err) {
        // Clear the previous range's numbers rather than leaving them on
        // screen underneath the error — otherwise a failed reload looks like
        // stale-but-current data for whatever range is now selected.
        setReport(null)
        return setError(err.message)
      }
      setReport(data as SalesReport)
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
    // "to" is exclusive in the RPC, so the end date's whole day must be included.
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

  // Export the CURRENTLY loaded, filtered report to a real .xlsx — one sheet
  // per breakdown, numeric cells for money/qty, user text guarded downstream.
  async function exportExcel() {
    // Defensive: the button is disabled without a report. Throwing rather than
    // returning quietly means a bug here surfaces as a failed-export toast
    // instead of a button that silently does nothing.
    if (!report) throw new Error("no report loaded yet")
    const { from, to } = activeRange()
    const r = report
    const sheets: SheetSpec[] = [
      {
        name: 'Summary', title: 'Sales summary',
        columns: [{ header: 'Metric', key: 'k', kind: 'text' }, { header: 'Value (₹)', key: 'v', kind: 'money' }],
        rows: [
          { k: 'Revenue (collected)', v: r.summary.revenue },
          { k: 'Orders', v: r.summary.orders },
          { k: 'Average order value', v: r.summary.aov },
          { k: 'Discounts given', v: r.summary.discount },
          { k: 'Tax collected', v: r.summary.tax },
          { k: 'Refunded', v: r.summary.refunds },
          ...(canSeeProfit && r.summary.expenses != null ? [{ k: 'Expenses', v: r.summary.expenses }] : []),
          ...(canSeeProfit && r.summary.net_profit != null ? [{ k: 'Net profit', v: r.summary.net_profit }] : []),
        ],
      },
      {
        name: 'Item sales', title: 'Item sales',
        columns: [{ header: 'Item', key: 'name', kind: 'text' }, { header: 'Qty', key: 'qty', kind: 'qty' }, { header: 'Revenue (₹)', key: 'revenue', kind: 'money' }],
        rows: r.top_items,
      },
      {
        name: 'Category sales', title: 'Category sales',
        columns: [{ header: 'Category', key: 'category', kind: 'text' }, { header: 'Revenue (₹)', key: 'revenue', kind: 'money' }],
        rows: r.by_category,
      },
      {
        name: 'Payments', title: 'Payments by method',
        columns: [{ header: 'Method', key: 'method', kind: 'text' }, { header: 'Revenue (₹)', key: 'revenue', kind: 'money' }],
        rows: r.by_payment_method.map((m) => ({ method: METHOD_LABEL[m.method] ?? m.method, revenue: m.revenue })),
      },
      {
        name: 'By day', title: 'Revenue by day',
        columns: [{ header: 'Date', key: 'date', kind: 'text' }, { header: 'Orders', key: 'orders', kind: 'qty' }, { header: 'Revenue (₹)', key: 'revenue', kind: 'money' }],
        rows: r.by_day,
      },
    ]
    if (r.by_staff.length) {
      sheets.push({
        name: 'By staff', title: 'Sales by staff',
        columns: [{ header: 'Staff', key: 'staff_name', kind: 'text' }, { header: 'Orders', key: 'orders', kind: 'qty' }, { header: 'Revenue (₹)', key: 'revenue', kind: 'money' }],
        rows: r.by_staff,
      })
    }
    const { downloadReport } = await import('@/lib/xlsx-export')
    return downloadReport({ cafeName, reportName: 'Sales', from, to }, sheets)
  }

  const maxDayRevenue = Math.max(1, ...(report?.by_day.map((d) => d.revenue) ?? [0]))

  const presets: { key: Preset; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: '7d', label: 'Last 7 days' },
    { key: '30d', label: 'Last 30 days' },
    { key: 'month', label: 'This month' },
    { key: 'custom', label: 'Custom' },
  ]

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <ReportsSubnav active="/dashboard/reports/sales" canSeeProfit={canSeeProfit} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Sales</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Money that actually settled in this range — unlike the dashboard&apos;s live count, unpaid orders aren&apos;t included.
          </p>
        </div>
        <button onClick={() => void runExport(exportExcel)} disabled={!report || exporting} className="min-h-10 rounded-[var(--radius)] bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-40">
          {exporting ? 'Exporting…' : 'Export Excel'}
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
              className="min-h-10 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[16px] text-foreground" />
          </label>
          <label className="space-y-1 text-[13px] text-foreground">
            <span className="block text-muted-foreground">To</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
              className="min-h-10 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[16px] text-foreground" />
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
          <div className="mt-6 grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <Metric label="Revenue" value={`₹${report.summary.revenue.toLocaleString('en-IN')}`} />
            <Metric label="Orders" value={report.summary.orders} />
            <Metric label="Avg order value" value={`₹${report.summary.aov.toLocaleString('en-IN')}`} />
            {canSeeProfit && report.summary.net_profit != null && (
              <Metric label="Net profit" value={`₹${report.summary.net_profit.toLocaleString('en-IN')}`} />
            )}
            <Metric label="Discounts given" value={`₹${report.summary.discount.toLocaleString('en-IN')}`} />
            <Metric label="Tax collected" value={`₹${report.summary.tax.toLocaleString('en-IN')}`} />
            <Metric label="Refunded" value={`₹${report.summary.refunds.toLocaleString('en-IN')}`} />
            {canSeeProfit && report.summary.expenses != null && (
              <Metric label="Expenses" value={`₹${report.summary.expenses.toLocaleString('en-IN')}`} />
            )}
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground">
            Revenue here counts only paid or refunded orders and includes tax — a different basis than the Overview
            page&apos;s &quot;Net Sales&quot;, which counts every non-cancelled order regardless of payment status and
            excludes tax. Both are correct for what they measure; they won&apos;t match.
            {canSeeProfit && (
              <>
                {' '}Net profit here is revenue minus refunds minus logged expenses — a cash-basis figure, not the
                same thing as the Profitability report&apos;s per-item gross profit (which nets item cost instead of
                expenses, and excludes tax). The two also won&apos;t match.
              </>
            )}
          </p>

          {report.by_day.length > 0 && (
            <Section title="Revenue by day">
              <div className="flex items-end gap-1.5 overflow-x-auto pb-1" style={{ height: 140 }}>
                {report.by_day.map((d) => (
                  <div key={d.date} className="flex min-w-[28px] flex-1 flex-col items-center justify-end gap-1" title={`${d.date}: ₹${d.revenue.toLocaleString('en-IN')} (${d.orders} orders)`}>
                    <div className="w-full rounded-t bg-primary" style={{ height: `${Math.max(4, (d.revenue / maxDayRevenue) * 110)}px` }} />
                    <span className="whitespace-nowrap text-[10px] text-muted-foreground">{d.date.slice(5)}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            {report.top_items.length > 0 && (
              <Section title="Top items">
                <List rows={report.top_items.map((i) => ({ label: `${i.name} × ${i.qty}`, value: i.revenue }))} />
              </Section>
            )}
            {report.by_category.length > 0 && (
              <Section title="By category">
                <List rows={report.by_category.map((c) => ({ label: c.category, value: c.revenue }))} />
              </Section>
            )}
            {report.by_payment_method.length > 0 && (
              <Section title="By payment method">
                <List rows={report.by_payment_method.map((m) => ({ label: METHOD_LABEL[m.method] ?? m.method, value: m.revenue }))} />
              </Section>
            )}
            {report.by_source.length > 0 && (
              <Section title="By order source">
                <List rows={report.by_source.map((s) => ({ label: `${SOURCE_LABEL[s.source] ?? s.source} (${s.orders})`, value: s.revenue }))} />
              </Section>
            )}
            {report.by_staff.length > 0 && (
              <Section title="By staff (counter orders)">
                <List rows={report.by_staff.map((s) => ({ label: `${s.staff_name} (${s.orders})`, value: s.revenue }))} />
              </Section>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-[12.5px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight text-foreground">{value}</p>
    </div>
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
