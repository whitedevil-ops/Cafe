'use client'

import { useCallback, useMemo, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { businessDayKey, businessDayStartISO, formatDate, formatDateTime } from '@/lib/datetime'
import { ReportsSubnav, Section, Kpi, Row, List } from '../_shared'

const METHOD_LABEL: Record<string, string> = { cash: 'Cash', card: 'Card', counter: 'Pay at counter', upi: 'UPI' }

type SalesData = {
  summary: { revenue: number; orders: number; aov: number; discount: number; tax: number; refunds: number; expenses: number | null; net_profit: number | null }
}
type PaymentsData = {
  by_method: { method: string; amount: number; transactions: number }[]
}
type GstData = {
  gst_registered: boolean
  summary: { invoices: number; taxable_value: number; tax: number; cgst: number; sgst: number }
}
type AdjustmentsData = {
  summary: {
    discounts_total: number; discounts_count: number
    refunds_total: number; refunds_count: number
    cancellations_total: number; cancellations_count: number
  }
}
type ShiftRow = {
  id: string; status: string; opened_at: string; closed_at: string | null
  opening_cash: number; expected_cash: number | null; counted_cash: number | null; difference: number | null
  opened_by_name: string | null; closed_by_name: string | null
}

export type DayCloseReports = {
  sales: SalesData | null
  gst: GstData | null
  adjustments: AdjustmentsData | null
  payments: PaymentsData | null
  shifts: ShiftRow[] | null
}

export default function DayCloseClient({
  cafeId,
  cafeName,
  role,
  timezone,
  initialFrom,
  initialTo,
  initialReports,
}: {
  cafeId: string
  cafeName: string
  role: string
  timezone: string
  initialFrom: string
  initialTo: string
  initialReports: DayCloseReports
}) {
  const supabase = useMemo(() => createClient(), [])
  const canSeeProfit = role === 'owner' || role === 'manager'
  const todayKey = businessDayKey(new Date(), timezone)
  const [dayKey, setDayKey] = useState(todayKey)
  const [range, setRange] = useState({ from: initialFrom, to: initialTo })
  const [reports, setReports] = useState<DayCloseReports>(initialReports)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (key: string) => {
      setLoading(true)
      setError(null)
      const from = businessDayStartISO(timezone, new Date(`${key}T12:00:00Z`))
      // Today isn't over yet — show "so far", same as every other report's Today preset.
      const to =
        key === todayKey
          ? new Date().toISOString()
          : businessDayStartISO(timezone, new Date(new Date(`${key}T12:00:00Z`).getTime() + 86400_000))

      const [sales, gst, adjustments, payments, shifts] = await Promise.all([
        supabase.rpc('sales_report', { p_cafe_id: cafeId, p_from: from, p_to: to }),
        supabase.rpc('gst_invoice_report', { p_cafe_id: cafeId, p_from: from, p_to: to }),
        supabase.rpc('adjustments_report', { p_cafe_id: cafeId, p_from: from, p_to: to }),
        supabase.rpc('payments_outstanding_report', { p_cafe_id: cafeId, p_from: from, p_to: to }),
        supabase.rpc('recent_shifts', { p_cafe_id: cafeId, p_limit: 20 }),
      ])
      setLoading(false)
      const firstError = sales.error || gst.error || adjustments.error || payments.error || shifts.error
      if (firstError) return setError(firstError.message)

      setRange({ from, to })
      setReports({
        sales: sales.data as SalesData,
        gst: gst.data as GstData,
        adjustments: adjustments.data as AdjustmentsData,
        payments: payments.data as PaymentsData,
        shifts: shifts.data as ShiftRow[],
      })
    },
    [supabase, cafeId, timezone, todayKey],
  )

  function chooseDay(key: string) {
    setDayKey(key)
    void load(key)
  }

  // A shift is a time window, not tied to calendar day — "this day's" shifts
  // are the ones OPENED inside the selected range, same as every figure above.
  const dayShifts = (reports.shifts ?? []).filter((s) => s.opened_at >= range.from && s.opened_at < range.to)
  const closedShifts = dayShifts.filter((s) => s.status === 'closed')
  const openShifts = dayShifts.filter((s) => s.status !== 'closed')
  const totalDifference = closedShifts.reduce((sum, s) => sum + (s.difference ?? 0), 0)

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 print:px-0 print:py-0">
      <div className="print:hidden">
        <ReportsSubnav active="/dashboard/reports/day-close" canSeeProfit={canSeeProfit} />
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Day Close</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {cafeName} — {formatDate(range.from, timezone)}
            {dayKey === todayKey ? ' (so far)' : ''}
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="min-h-10 rounded-[var(--radius)] border border-border-strong bg-surface px-4 text-[13px] font-medium text-foreground hover:bg-surface-subtle print:hidden"
        >
          Print
        </button>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2 print:hidden">
        <button
          onClick={() => chooseDay(todayKey)}
          className={`min-h-9 rounded-[var(--radius)] border px-3 text-[13px] font-medium transition-colors ${
            dayKey === todayKey ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-muted-foreground hover:bg-surface-subtle'
          }`}
        >
          Today
        </button>
        <button
          onClick={() => chooseDay(businessDayKey(new Date(new Date(`${todayKey}T12:00:00Z`).getTime() - 86400_000), timezone))}
          className={`min-h-9 rounded-[var(--radius)] border px-3 text-[13px] font-medium transition-colors ${
            dayKey !== todayKey ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-muted-foreground hover:bg-surface-subtle'
          }`}
        >
          Yesterday
        </button>
        <input
          type="date"
          value={dayKey}
          max={todayKey}
          onChange={(e) => chooseDay(e.target.value)}
          className="min-h-9 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[13px] text-foreground"
        />
      </div>

      {error && <p className="mt-4 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">{error}</p>}

      {loading ? (
        <p className="mt-8 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <Kpi label="Revenue" value={`₹${(reports.sales?.summary.revenue ?? 0).toLocaleString('en-IN')}`} />
            <Kpi label="Orders" value={String(reports.sales?.summary.orders ?? 0)} />
            <Kpi label="Avg order value" value={`₹${reports.sales?.summary.aov ?? 0}`} />
            <Kpi label="Discounts given" value={`₹${(reports.sales?.summary.discount ?? 0).toLocaleString('en-IN')}`} />
            <Kpi label="Tax collected" value={`₹${(reports.sales?.summary.tax ?? 0).toLocaleString('en-IN')}`} />
            <Kpi
              label="Refunded"
              value={`₹${(reports.sales?.summary.refunds ?? 0).toLocaleString('en-IN')}`}
              tone={(reports.sales?.summary.refunds ?? 0) > 0 ? 'destructive' : undefined}
            />
            {canSeeProfit && reports.sales?.summary.expenses != null && (
              <Kpi label="Expenses" value={`₹${reports.sales.summary.expenses.toLocaleString('en-IN')}`} />
            )}
            {canSeeProfit && reports.sales?.summary.net_profit != null && (
              <Kpi label="Net profit" value={`₹${reports.sales.summary.net_profit.toLocaleString('en-IN')}`} />
            )}
          </div>

          {/* Actual till reconciliation — real payment rows by tender type, not
              the order's single declared payment_method (which collapses a
              split payment into one 'split' row and can't show real cash vs
              UPI collected). */}
          {(reports.payments?.by_method.length ?? 0) > 0 && (
            <Section title="By payment method">
              <List rows={(reports.payments?.by_method ?? []).map((m) => ({ label: METHOD_LABEL[m.method] ?? m.method, value: m.amount }))} />
            </Section>
          )}

          {reports.gst?.gst_registered && (
            <Section title="GST">
              <ul className="space-y-2">
                <Row label="Invoices" value={reports.gst.summary.invoices} />
                <Row label="Taxable value" value={reports.gst.summary.taxable_value} />
                <Row label="CGST" value={reports.gst.summary.cgst} />
                <Row label="SGST" value={reports.gst.summary.sgst} />
                <Row label="Total tax" value={reports.gst.summary.tax} bold />
              </ul>
            </Section>
          )}

          <Section title="Discounts, refunds & cancellations">
            <ul className="space-y-2">
              <Row label={`Discounts (${reports.adjustments?.summary.discounts_count ?? 0})`} value={reports.adjustments?.summary.discounts_total ?? 0} />
              <Row label={`Refunds (${reports.adjustments?.summary.refunds_count ?? 0})`} value={reports.adjustments?.summary.refunds_total ?? 0} />
              <Row
                label={`Cancellations (${reports.adjustments?.summary.cancellations_count ?? 0})`}
                value={reports.adjustments?.summary.cancellations_total ?? 0}
              />
            </ul>
          </Section>

          <Section title="Cash shifts">
            {dayShifts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No shifts opened this day.</p>
            ) : (
              <div className="space-y-3">
                {dayShifts.map((s) => (
                  <div key={s.id} className="rounded-[var(--radius)] border border-border p-3 text-[13px]">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-foreground">
                        {formatDateTime(s.opened_at, timezone)}
                        {s.closed_at ? ` – ${formatDateTime(s.closed_at, timezone)}` : ''}
                      </span>
                      <span className={s.status === 'closed' ? 'text-muted-foreground' : 'font-medium text-warning'}>
                        {s.status === 'closed' ? 'Closed' : 'Still open'}
                      </span>
                    </div>
                    {s.status === 'closed' ? (
                      <div className="mt-2 grid grid-cols-3 gap-2 text-muted-foreground">
                        <span>Expected ₹{(s.expected_cash ?? 0).toLocaleString('en-IN')}</span>
                        <span>Counted ₹{(s.counted_cash ?? 0).toLocaleString('en-IN')}</span>
                        <span className={(s.difference ?? 0) < 0 ? 'text-destructive' : (s.difference ?? 0) > 0 ? 'text-success' : ''}>
                          Diff {(s.difference ?? 0) >= 0 ? '+' : ''}₹{(s.difference ?? 0).toLocaleString('en-IN')}
                        </span>
                      </div>
                    ) : (
                      <p className="mt-2 text-muted-foreground">Not closed yet — cash variance for this shift isn&apos;t final.</p>
                    )}
                  </div>
                ))}
                {openShifts.length > 0 && (
                  <p className="text-[12px] text-warning">
                    {openShifts.length} shift{openShifts.length === 1 ? '' : 's'} still open — the total below excludes{' '}
                    {openShifts.length === 1 ? 'it' : 'them'}.
                  </p>
                )}
                <div className="flex items-center justify-between border-t border-border pt-2 font-semibold text-foreground">
                  <span>Total cash variance (closed shifts)</span>
                  <span className={totalDifference < 0 ? 'text-destructive' : totalDifference > 0 ? 'text-success' : ''}>
                    {totalDifference >= 0 ? '+' : ''}₹{totalDifference.toLocaleString('en-IN')}
                  </span>
                </div>
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  )
}
