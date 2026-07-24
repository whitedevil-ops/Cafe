'use client'

import { useState } from 'react'
import { formatDateTime } from '@/lib/datetime'
import { downloadReport, type SheetSpec } from '@/lib/xlsx-export'
import { ReportsSubnav, ReportHeader, RangePicker, useReportRange } from '../_shared'

export type AdjustmentsReport = {
  summary: {
    discounts_total: number; discounts_count: number
    refunds_total: number; refunds_count: number
    cancellations_total: number; cancellations_count: number
  }
  discounts: { order_id: string; short_code: string | null; actor: string; type: string | null; coupon_code: string | null; amount: number; created_at: string }[]
  refunds: { order_id: string; short_code: string | null; actor: string; kind: string; reason: string; amount: number; approved_by: string | null; created_at: string }[]
  cancellations: { order_id: string; short_code: string; actor: string; reason: string; amount: number; created_at: string }[]
}

type Tab = 'discounts' | 'refunds' | 'cancellations'

export default function AdjustmentsClient({
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
  initialReport: AdjustmentsReport | null
}) {
  const canSeeProfit = role === 'owner' || role === 'manager'
  const [tab, setTab] = useState<Tab>('discounts')
  const { report, loading, error, preset, choosePreset, customFrom, setCustomFrom, customTo, setCustomTo, applyCustom, activeRange } =
    useReportRange<AdjustmentsReport>({ cafeId, timezone, rpc: 'adjustments_report', initialFrom, initialTo, initialReport })

  function exportExcel() {
    if (!report) return
    const { from, to } = activeRange()
    const sheets: SheetSpec[] = [
      {
        name: 'Discounts', title: 'Discounts applied',
        columns: [
          { header: 'Order', key: 'short_code', kind: 'text' }, { header: 'Staff', key: 'actor', kind: 'text' },
          { header: 'Type', key: 'type', kind: 'text' }, { header: 'Coupon', key: 'coupon_code', kind: 'text' },
          { header: 'Amount (₹)', key: 'amount', kind: 'money' }, { header: 'When', key: 'when', kind: 'text' },
        ],
        rows: report.discounts.map((d) => ({ ...d, when: formatDateTime(d.created_at, timezone) })),
      },
      {
        name: 'Refunds', title: 'Refunds issued',
        columns: [
          { header: 'Order', key: 'short_code', kind: 'text' }, { header: 'Staff', key: 'actor', kind: 'text' },
          { header: 'Kind', key: 'kind', kind: 'text' }, { header: 'Reason', key: 'reason', kind: 'text' },
          { header: 'Amount (₹)', key: 'amount', kind: 'money' }, { header: 'Approved by', key: 'approved_by', kind: 'text' },
          { header: 'When', key: 'when', kind: 'text' },
        ],
        rows: report.refunds.map((r) => ({ ...r, when: formatDateTime(r.created_at, timezone) })),
      },
      {
        name: 'Cancellations', title: 'Orders cancelled',
        columns: [
          { header: 'Order', key: 'short_code', kind: 'text' }, { header: 'Staff', key: 'actor', kind: 'text' },
          { header: 'Reason', key: 'reason', kind: 'text' }, { header: 'Order value (₹)', key: 'amount', kind: 'money' },
          { header: 'When', key: 'when', kind: 'text' },
        ],
        rows: report.cancellations.map((c) => ({ ...c, when: formatDateTime(c.created_at, timezone) })),
      },
    ]
    downloadReport({ cafeName, reportName: 'Adjustments', from, to }, sheets)
  }

  const tabs: { key: Tab; label: string; count: number }[] = report
    ? [
        { key: 'discounts', label: 'Discounts', count: report.summary.discounts_count },
        { key: 'refunds', label: 'Refunds', count: report.summary.refunds_count },
        { key: 'cancellations', label: 'Cancellations', count: report.summary.cancellations_count },
      ]
    : []

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <ReportsSubnav active="/dashboard/reports/adjustments" canSeeProfit={canSeeProfit} />
      <ReportHeader
        title="Adjustments"
        subtitle="Every discount, refund and cancellation in this range, with who did it and why — for accountability review."
        links={[]}
        onExport={exportExcel}
        canExport={Boolean(report)}
      />
      <RangePicker preset={preset} choosePreset={choosePreset} customFrom={customFrom} setCustomFrom={setCustomFrom} customTo={customTo} setCustomTo={setCustomTo} applyCustom={applyCustom} />

      {error && <p className="mt-4 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">{error}</p>}

      {loading ? (
        <p className="mt-8 text-sm text-muted-foreground">Loading…</p>
      ) : !report ? (
        <p className="mt-8 text-sm text-muted-foreground">No data for this range.</p>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[12.5px] text-muted-foreground">Discounts ({report.summary.discounts_count})</p>
              <p className="mt-1 text-xl font-semibold tracking-tight text-foreground">₹{report.summary.discounts_total.toLocaleString('en-IN')}</p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[12.5px] text-muted-foreground">Refunds ({report.summary.refunds_count})</p>
              <p className="mt-1 text-xl font-semibold tracking-tight text-foreground">₹{report.summary.refunds_total.toLocaleString('en-IN')}</p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[12.5px] text-muted-foreground">Cancellations ({report.summary.cancellations_count})</p>
              <p className="mt-1 text-xl font-semibold tracking-tight text-foreground">₹{report.summary.cancellations_total.toLocaleString('en-IN')}</p>
            </div>
          </div>

          <div className="mt-6 flex gap-2">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`min-h-9 rounded-[var(--radius)] border px-3 text-[13px] font-medium transition-colors ${
                  tab === t.key ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-muted-foreground hover:bg-surface-subtle'
                }`}
              >
                {t.label} ({t.count})
              </button>
            ))}
          </div>

          <div className="mt-4 rounded-xl border border-border bg-surface p-4">
            {tab === 'discounts' && (
              report.discounts.length === 0 ? <p className="text-sm text-muted-foreground">No discounts in this range.</p> : (
                <ul className="divide-y divide-border">
                  {report.discounts.map((d, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <div className="min-w-0">
                        <p className="text-foreground">
                          #{d.short_code ?? '—'} · {d.actor}
                          {d.coupon_code ? ` · coupon ${d.coupon_code}` : d.type ? ` · ${d.type}` : ''}
                        </p>
                        <p className="text-[12px] text-muted-foreground">{formatDateTime(d.created_at, timezone)}</p>
                      </div>
                      <span className="shrink-0 font-medium text-primary">−₹{d.amount.toLocaleString('en-IN')}</span>
                    </li>
                  ))}
                </ul>
              )
            )}
            {tab === 'refunds' && (
              report.refunds.length === 0 ? <p className="text-sm text-muted-foreground">No refunds in this range.</p> : (
                <ul className="divide-y divide-border">
                  {report.refunds.map((r, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <div className="min-w-0">
                        <p className="text-foreground">#{r.short_code ?? '—'} · {r.actor} · {r.kind}</p>
                        <p className="truncate text-[12px] text-muted-foreground">{r.reason}{r.approved_by ? ` · approved by ${r.approved_by}` : ''}</p>
                        <p className="text-[12px] text-muted-foreground">{formatDateTime(r.created_at, timezone)}</p>
                      </div>
                      <span className="shrink-0 font-medium text-destructive">−₹{r.amount.toLocaleString('en-IN')}</span>
                    </li>
                  ))}
                </ul>
              )
            )}
            {tab === 'cancellations' && (
              report.cancellations.length === 0 ? <p className="text-sm text-muted-foreground">No cancellations in this range.</p> : (
                <ul className="divide-y divide-border">
                  {report.cancellations.map((c, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <div className="min-w-0">
                        <p className="text-foreground">#{c.short_code} · {c.actor}</p>
                        <p className="truncate text-[12px] text-muted-foreground">{c.reason}</p>
                        <p className="text-[12px] text-muted-foreground">{formatDateTime(c.created_at, timezone)}</p>
                      </div>
                      <span className="shrink-0 font-medium text-muted-foreground">₹{c.amount.toLocaleString('en-IN')}</span>
                    </li>
                  ))}
                </ul>
              )
            )}
          </div>
        </>
      )}
    </div>
  )
}
