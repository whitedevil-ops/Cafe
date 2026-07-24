'use client'

import { downloadReport, type SheetSpec } from '@/lib/xlsx-export'
import { ReportsSubnav, ReportHeader, RangePicker, Section, useReportRange } from '../_shared'

export type OperationsReport = {
  turnaround: { avg_mins: number; median_mins: number; completed_orders: number; buckets: { bucket: string; orders: number }[] }
  table_turnover: { avg_mins: number; sessions: number }
  cancelled_orders: number
}

export default function OperationsClient({
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
  initialReport: OperationsReport | null
}) {
  const canSeeProfit = role === 'owner' || role === 'manager'
  const { report, loading, error, preset, choosePreset, customFrom, setCustomFrom, customTo, setCustomTo, applyCustom, activeRange } =
    useReportRange<OperationsReport>({ cafeId, timezone, rpc: 'operations_report', initialFrom, initialTo, initialReport })

  function exportExcel() {
    if (!report) return
    const { from, to } = activeRange()
    const sheets: SheetSpec[] = [
      {
        name: 'Summary', title: 'Operations summary',
        columns: [{ header: 'Metric', key: 'k', kind: 'text' }, { header: 'Value', key: 'v', kind: 'text' }],
        rows: [
          { k: 'Avg order-to-completion time (min)', v: report.turnaround.avg_mins },
          { k: 'Median order-to-completion time (min)', v: report.turnaround.median_mins },
          { k: 'Completed orders', v: report.turnaround.completed_orders },
          { k: 'Avg table turnover time (min)', v: report.table_turnover.avg_mins },
          { k: 'Closed table sessions', v: report.table_turnover.sessions },
          { k: 'Cancelled orders', v: report.cancelled_orders },
        ],
      },
      {
        name: 'Turnaround buckets', title: 'Order-to-completion time distribution',
        columns: [{ header: 'Bucket', key: 'bucket', kind: 'text' }, { header: 'Orders', key: 'orders', kind: 'qty' }],
        rows: report.turnaround.buckets,
      },
    ]
    downloadReport({ cafeName, reportName: 'Operations', from, to }, sheets)
  }

  const maxBucket = Math.max(1, ...(report?.turnaround.buckets.map((b) => b.orders) ?? [0]))

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <ReportsSubnav active="/dashboard/reports/operations" canSeeProfit={canSeeProfit} />
      <ReportHeader
        title="Operations"
        subtitle="How fast orders actually get done, and how quickly tables turn over — the two things nothing else in Reports shows."
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
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[12.5px] text-muted-foreground">Avg order-to-completion</p>
              <p className="mt-1 text-xl font-semibold tracking-tight text-foreground">{report.turnaround.avg_mins} min</p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[12.5px] text-muted-foreground">Median order-to-completion</p>
              <p className="mt-1 text-xl font-semibold tracking-tight text-foreground">{report.turnaround.median_mins} min</p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[12.5px] text-muted-foreground">Avg table turnover</p>
              <p className="mt-1 text-xl font-semibold tracking-tight text-foreground">
                {report.table_turnover.sessions > 0 ? `${report.table_turnover.avg_mins} min` : '—'}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[12.5px] text-muted-foreground">Cancelled orders</p>
              <p className="mt-1 text-xl font-semibold tracking-tight text-foreground">{report.cancelled_orders}</p>
            </div>
          </div>

          {report.turnaround.buckets.length > 0 && (
            <Section title={`Order-to-completion time (${report.turnaround.completed_orders} completed orders)`}>
              <div className="flex items-end gap-3" style={{ height: 130 }}>
                {report.turnaround.buckets.map((b) => (
                  <div key={b.bucket} className="flex min-w-[70px] flex-1 flex-col items-center justify-end gap-1" title={`${b.bucket}: ${b.orders} orders`}>
                    <span className="text-[12px] font-medium text-foreground">{b.orders}</span>
                    <div className="w-full rounded-t bg-primary" style={{ height: `${Math.max(4, (b.orders / maxBucket) * 90)}px` }} />
                    <span className="whitespace-nowrap text-[10.5px] text-muted-foreground">{b.bucket}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {report.table_turnover.sessions === 0 && report.turnaround.completed_orders === 0 && (
            <p className="mt-8 text-sm text-muted-foreground">
              No completed orders or closed table sessions in this range yet — this report fills in as service happens.
            </p>
          )}
        </>
      )}
    </div>
  )
}
