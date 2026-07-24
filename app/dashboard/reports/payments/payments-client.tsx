'use client'

import { formatDate } from '@/lib/datetime'
import { downloadReport, type SheetSpec } from '@/lib/xlsx-export'
import { ReportsSubnav, ReportHeader, RangePicker, Section, List, useReportRange } from '../_shared'

export type PaymentsReport = {
  summary: { collected: number; collected_transactions: number; outstanding_amount: number; outstanding_orders: number }
  by_method: { method: string; amount: number; transactions: number }[]
  aging: { bucket: string; amount: number; orders: number }[]
  outstanding_bills: { order_id: string; short_code: string; type: string; total: number; paid: number; due: number; created_at: string }[]
}

const METHOD_LABEL: Record<string, string> = { cash: 'Cash', card: 'Card', counter: 'Pay at counter', upi: 'UPI', split: 'Split' }
const TYPE_LABEL: Record<string, string> = { dine_in: 'Dine-in', takeaway: 'Takeaway' }

export default function PaymentsClient({
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
  initialReport: PaymentsReport | null
}) {
  const canSeeProfit = role === 'owner' || role === 'manager'
  const { report, loading, error, preset, choosePreset, customFrom, setCustomFrom, customTo, setCustomTo, applyCustom, activeRange } =
    useReportRange<PaymentsReport>({ cafeId, timezone, rpc: 'payments_outstanding_report', initialFrom, initialTo, initialReport })

  function exportExcel() {
    if (!report) return
    const { from, to } = activeRange()
    const sheets: SheetSpec[] = [
      {
        name: 'By method', title: 'Collected by payment method',
        columns: [
          { header: 'Method', key: 'method', kind: 'text' },
          { header: 'Amount (₹)', key: 'amount', kind: 'money' },
          { header: 'Transactions', key: 'transactions', kind: 'qty' },
        ],
        rows: report.by_method.map((m) => ({ method: METHOD_LABEL[m.method] ?? m.method, amount: m.amount, transactions: m.transactions })),
      },
      {
        name: 'Aging', title: 'Outstanding by age',
        columns: [{ header: 'Age', key: 'bucket', kind: 'text' }, { header: 'Amount (₹)', key: 'amount', kind: 'money' }, { header: 'Orders', key: 'orders', kind: 'qty' }],
        rows: report.aging,
      },
      {
        name: 'Outstanding bills', title: 'Outstanding bills (oldest first)',
        columns: [
          { header: 'Order', key: 'short_code', kind: 'text' },
          { header: 'Type', key: 'type', kind: 'text' },
          { header: 'Total (₹)', key: 'total', kind: 'money' },
          { header: 'Paid (₹)', key: 'paid', kind: 'money' },
          { header: 'Due (₹)', key: 'due', kind: 'money' },
          { header: 'Placed', key: 'placed', kind: 'text' },
        ],
        rows: report.outstanding_bills.map((b) => ({ ...b, type: TYPE_LABEL[b.type] ?? b.type, placed: formatDate(b.created_at, timezone) })),
      },
    ]
    downloadReport({ cafeName, reportName: 'Payments-Outstanding', from, to }, sheets)
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <ReportsSubnav active="/dashboard/reports/payments" canSeeProfit={canSeeProfit} />
      <ReportHeader
        title="Payments & Outstanding"
        subtitle="What actually came in, by method — plus every bill still owed, aged by how long it's been open."
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
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[12.5px] text-muted-foreground">Collected ({report.summary.collected_transactions} transactions)</p>
              <p className="mt-1 text-xl font-semibold tracking-tight text-success">₹{report.summary.collected.toLocaleString('en-IN')}</p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[12.5px] text-muted-foreground">Outstanding ({report.summary.outstanding_orders} orders)</p>
              <p className={`mt-1 text-xl font-semibold tracking-tight ${report.summary.outstanding_amount > 0 ? 'text-destructive' : 'text-foreground'}`}>
                ₹{report.summary.outstanding_amount.toLocaleString('en-IN')}
              </p>
            </div>
          </div>

          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            {report.by_method.length > 0 && (
              <Section title="Collected by method">
                <List rows={report.by_method.map((m) => ({ label: `${METHOD_LABEL[m.method] ?? m.method} (${m.transactions})`, value: m.amount }))} />
              </Section>
            )}
            {report.aging.length > 0 && (
              <Section title="Outstanding, by age">
                <List rows={report.aging.map((a) => ({ label: `${a.bucket} (${a.orders} orders)`, value: a.amount }))} />
              </Section>
            )}
          </div>

          <Section title={`Outstanding bills (${report.outstanding_bills.length}${report.outstanding_bills.length >= 100 ? '+' : ''})`}>
            {report.outstanding_bills.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing outstanding in this range.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[12px] uppercase tracking-wide text-muted-foreground">
                      <th className="pb-2 font-medium">Order</th>
                      <th className="pb-2 font-medium">Type</th>
                      <th className="pb-2 font-medium">Placed</th>
                      <th className="pb-2 text-right font-medium">Total</th>
                      <th className="pb-2 text-right font-medium">Due</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {report.outstanding_bills.map((b) => (
                      <tr key={b.order_id}>
                        <td className="py-1.5 text-foreground">#{b.short_code}</td>
                        <td className="py-1.5 text-muted-foreground">{TYPE_LABEL[b.type] ?? b.type}</td>
                        <td className="py-1.5 text-muted-foreground">{formatDate(b.created_at, timezone)}</td>
                        <td className="py-1.5 text-right text-muted-foreground">₹{b.total.toLocaleString('en-IN')}</td>
                        <td className="py-1.5 text-right font-medium text-destructive">₹{b.due.toLocaleString('en-IN')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  )
}
