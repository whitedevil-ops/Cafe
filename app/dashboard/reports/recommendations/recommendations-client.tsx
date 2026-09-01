'use client'

import type { SheetSpec } from '@/lib/xlsx-export'
import { ReportsSubnav, ReportHeader, RangePicker, useReportRange } from '../_shared'

export type RecommendationsReport = {
  items: { name: string; shown: number; added: number; conversion: number; added_sales: number }[]
  top_pairings: { a: string; b: string; times: number }[]
}

const money = (n: number) => `₹${n.toLocaleString('en-IN')}`

export default function RecommendationsClient({
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
  initialReport: RecommendationsReport | null
  initialError?: string | null
}) {
  const canSeeProfit = role === 'owner' || role === 'manager'
  const { report, loading, error, preset, choosePreset, customFrom, setCustomFrom, customTo, setCustomTo, applyCustom, activeRange } =
    useReportRange<RecommendationsReport>({ cafeId, timezone, rpc: 'recommendation_report', initialFrom, initialTo, initialReport, initialError })

  async function exportExcel() {
    // Defensive: the button is disabled without a report. Throwing rather than
    // returning quietly means a bug here surfaces as a failed-export toast
    // instead of a button that silently does nothing.
    if (!report) throw new Error("no report loaded yet")
    const { from, to } = activeRange()
    const sheets: SheetSpec[] = [
      {
        name: 'Items', title: 'Recommendation performance',
        columns: [
          { header: 'Suggested item', key: 'name', kind: 'text' },
          { header: 'Shown', key: 'shown', kind: 'qty' },
          { header: 'Added', key: 'added', kind: 'qty' },
          { header: 'Conversion %', key: 'conversion', kind: 'pct' },
          { header: 'Cart adds value (₹)', key: 'added_sales', kind: 'money' },
        ],
        rows: report.items,
      },
      {
        name: 'Top pairings', title: 'Items frequently ordered together',
        columns: [
          { header: 'Item A', key: 'a', kind: 'text' },
          { header: 'Item B', key: 'b', kind: 'text' },
          { header: 'Times', key: 'times', kind: 'qty' },
        ],
        rows: report.top_pairings,
      },
    ]
    const { downloadReport } = await import('@/lib/xlsx-export')
    return downloadReport({ cafeName, reportName: 'Recommendations', from, to }, sheets)
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <ReportsSubnav active="/dashboard/reports/recommendations" canSeeProfit={canSeeProfit} />
      <ReportHeader
        title="Smart recommendations"
        subtitle="See which suggestions actually get added — remove anything that doesn't convert."
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
          <div className="mt-6 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[600px] text-left text-[13px]">
              <thead className="bg-surface-subtle text-[12px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Suggested item</th>
                  <th className="px-3 py-2.5 text-right font-medium">Shown</th>
                  <th className="px-3 py-2.5 text-right font-medium">Added</th>
                  <th className="px-3 py-2.5 text-right font-medium">Conversion</th>
                  <th
                    className="px-3 py-2.5 text-right font-medium"
                    title="Value of cart-adds at the time each happened — not linked to whether the order was later completed, cancelled, or refunded"
                  >
                    Cart adds value
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-surface">
                {report.items.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">No recommendation activity in this range.</td></tr>
                ) : (
                  report.items.map((i) => (
                    <tr key={i.name} className="hover:bg-surface-subtle">
                      <td className="px-3 py-2.5 font-medium text-foreground">{i.name}</td>
                      <td className="px-3 py-2.5 text-right text-muted-foreground">{i.shown}</td>
                      <td className="px-3 py-2.5 text-right text-muted-foreground">{i.added}</td>
                      <td className={`px-3 py-2.5 text-right font-medium ${i.conversion >= 20 ? 'text-success' : i.conversion > 0 ? 'text-warning' : 'text-muted-foreground'}`}>{i.conversion}%</td>
                      <td className="px-3 py-2.5 text-right font-medium text-foreground">{money(i.added_sales)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-8">
            <p className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">Top pairings</p>
            {report.top_pairings.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">Not enough order history in this range yet — pairings appear once items are frequently ordered together.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {report.top_pairings.map((p, i) => (
                  <li key={i} className="flex items-center justify-between rounded-[var(--radius)] border border-border bg-surface px-3 py-2 text-[13px]">
                    <span className="text-foreground">{p.a} + {p.b}</span>
                    <span className="text-muted-foreground">{p.times}×</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}
