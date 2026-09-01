'use client'

import Link from 'next/link'
import { formatDate } from '@/lib/datetime'
import type { SheetSpec } from '@/lib/xlsx-export'
import { ReportsSubnav, ReportHeader, RangePicker, useReportRange } from '../_shared'

export type GstReport = {
  gst_registered: boolean
  summary: { invoices: number; taxable_value: number; tax: number; cgst: number; sgst: number }
  credit_note_summary: { count: number; taxable_value: number; tax: number; cgst: number; sgst: number }
  net_summary: { taxable_value: number; tax: number; cgst: number; sgst: number }
  by_rate: { hsn_sac: string; tax_percent: number; taxable_value: number; cgst: number; sgst: number; tax: number }[]
  invoices: { invoice_number: string; issued_at: string; short_code: string; taxable_value: number; tax: number; cgst: number; sgst: number; total: number }[]
  credit_notes: { credit_note_number: string; issued_at: string; order_id: string; amount: number; taxable_value: number; tax: number; cgst: number; sgst: number; reason: string }[]
  invoices_truncated: boolean
  credit_notes_truncated: boolean
}

export default function GstClient({
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
  initialReport: GstReport | null
  initialError?: string | null
}) {
  const canSeeProfit = role === 'owner' || role === 'manager'
  const { report, loading, error, preset, choosePreset, customFrom, setCustomFrom, customTo, setCustomTo, applyCustom, activeRange } =
    useReportRange<GstReport>({ cafeId, timezone, rpc: 'gst_invoice_report_premium', initialFrom, initialTo, initialReport, initialError })

  async function exportExcel() {
    // Defensive: the button is disabled without a report. Throwing rather than
    // returning quietly means a bug here surfaces as a failed-export toast
    // instead of a button that silently does nothing.
    if (!report) throw new Error("no report loaded yet")
    const { from, to } = activeRange()
    const r = report
    const sheets: SheetSpec[] = [
      {
        name: 'Summary', title: 'GST summary',
        columns: [{ header: 'Metric', key: 'k', kind: 'text' }, { header: 'Value', key: 'v', kind: 'money' }],
        rows: [
          { k: 'Invoices', v: r.summary.invoices },
          { k: 'Taxable value', v: r.summary.taxable_value },
          { k: 'CGST', v: r.summary.cgst },
          { k: 'SGST', v: r.summary.sgst },
          { k: 'Tax', v: r.summary.tax },
          { k: 'Credit notes issued', v: r.credit_note_summary.count },
          { k: 'Credit notes — taxable value', v: r.credit_note_summary.taxable_value },
          { k: 'Credit notes — tax reversed', v: r.credit_note_summary.tax },
          { k: 'Net taxable value (original − credit notes)', v: r.net_summary.taxable_value },
          { k: 'Net CGST', v: r.net_summary.cgst },
          { k: 'Net SGST', v: r.net_summary.sgst },
          { k: 'Net tax', v: r.net_summary.tax },
        ],
      },
      {
        name: 'By rate', title: 'Tax by HSN/SAC and rate',
        columns: [
          { header: 'HSN/SAC', key: 'hsn_sac', kind: 'text' },
          { header: 'Rate %', key: 'tax_percent', kind: 'pct' },
          { header: 'Taxable Value (₹)', key: 'taxable_value', kind: 'money' },
          { header: 'CGST (₹)', key: 'cgst', kind: 'money' },
          { header: 'SGST (₹)', key: 'sgst', kind: 'money' },
          { header: 'Total Tax (₹)', key: 'tax', kind: 'money' },
        ],
        rows: report.by_rate,
      },
      {
        name: 'Invoices', title: 'GST invoice register',
        columns: [
          { header: 'Invoice #', key: 'invoice_number', kind: 'text' },
          { header: 'Date', key: 'issued', kind: 'text' },
          { header: 'Order', key: 'short_code', kind: 'text' },
          { header: 'Taxable Value (₹)', key: 'taxable_value', kind: 'money' },
          { header: 'CGST (₹)', key: 'cgst', kind: 'money' },
          { header: 'SGST (₹)', key: 'sgst', kind: 'money' },
          { header: 'Total (₹)', key: 'total', kind: 'money' },
        ],
        rows: report.invoices.map((i) => ({ ...i, issued: formatDate(i.issued_at, timezone) })),
      },
      {
        name: 'Credit notes', title: 'GST credit note register (refunds)',
        columns: [
          { header: 'Credit note #', key: 'credit_note_number', kind: 'text' },
          { header: 'Date', key: 'issued', kind: 'text' },
          { header: 'Taxable Value (₹)', key: 'taxable_value', kind: 'money' },
          { header: 'CGST (₹)', key: 'cgst', kind: 'money' },
          { header: 'SGST (₹)', key: 'sgst', kind: 'money' },
          { header: 'Amount (₹)', key: 'amount', kind: 'money' },
          { header: 'Reason', key: 'reason', kind: 'text' },
        ],
        rows: report.credit_notes.map((c) => ({ ...c, issued: formatDate(c.issued_at, timezone) })),
      },
    ]
    const { downloadReport } = await import('@/lib/xlsx-export')
    return downloadReport({ cafeName, reportName: 'GST', from, to }, sheets)
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <ReportsSubnav active="/dashboard/reports/gst" canSeeProfit={canSeeProfit} />
      <ReportHeader
        title="GST"
        subtitle="Invoice-basis, not accrual — only orders that were actually issued a GST invoice, exactly as it read at the time."
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
      ) : !report.gst_registered ? (
        <p className="mt-8 rounded-[var(--radius)] bg-info-subtle px-3 py-2.5 text-[13px] text-info">
          This café isn&apos;t marked GST-registered, so no GST invoices are issued. Turn it on under{' '}
          <Link href="/dashboard/profile" className="font-medium underline">Café profile → Business &amp; GST</Link> if that&apos;s changed.
        </p>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[12.5px] text-muted-foreground">Invoices</p>
              <p className="mt-1 text-xl font-semibold tracking-tight text-foreground">{report.summary.invoices}</p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[12.5px] text-muted-foreground">Taxable value (before credit notes)</p>
              <p className="mt-1 text-xl font-semibold tracking-tight text-foreground">₹{report.summary.taxable_value.toLocaleString('en-IN')}</p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[12.5px] text-muted-foreground">CGST (before credit notes)</p>
              <p className="mt-1 text-xl font-semibold tracking-tight text-foreground">₹{report.summary.cgst.toLocaleString('en-IN')}</p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[12.5px] text-muted-foreground">SGST (before credit notes)</p>
              <p className="mt-1 text-xl font-semibold tracking-tight text-foreground">₹{report.summary.sgst.toLocaleString('en-IN')}</p>
            </div>
          </div>

          <p className="mt-4 rounded-[var(--radius)] bg-info-subtle px-3 py-2.5 text-[12.5px] text-info">
            Credit-note tax on an order mixing multiple GST rates is approximated (split proportionally to the order&apos;s
            overall tax ratio, not per rate), and there is no automatic check against the CGST Act s.34 credit-note
            deadline. Have a CA or GST practitioner review this report before relying on it for a return.
          </p>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[12.5px] text-muted-foreground">Credit notes issued</p>
              <p className="mt-1 text-xl font-semibold tracking-tight text-foreground">{report.credit_note_summary.count}</p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[12.5px] text-muted-foreground">Tax reversed (credit notes)</p>
              <p className="mt-1 text-xl font-semibold tracking-tight text-destructive">−₹{report.credit_note_summary.tax.toLocaleString('en-IN')}</p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[12.5px] text-muted-foreground">Net tax (original − credit notes)</p>
              <p className="mt-1 text-xl font-semibold tracking-tight text-foreground">₹{report.net_summary.tax.toLocaleString('en-IN')}</p>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">CGST ₹{report.net_summary.cgst.toLocaleString('en-IN')} · SGST ₹{report.net_summary.sgst.toLocaleString('en-IN')}</p>
            </div>
          </div>

          <div className="mt-8">
            <p className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">By HSN/SAC &amp; rate</p>
            <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-surface p-4">
              {report.by_rate.length === 0 ? (
                <p className="text-sm text-muted-foreground">No invoices in this range.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[12px] uppercase tracking-wide text-muted-foreground">
                      <th className="pb-2 font-medium">HSN/SAC</th>
                      <th className="pb-2 text-right font-medium">Rate</th>
                      <th className="pb-2 text-right font-medium">Taxable value</th>
                      <th className="pb-2 text-right font-medium">CGST</th>
                      <th className="pb-2 text-right font-medium">SGST</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {report.by_rate.map((r, i) => (
                      <tr key={i}>
                        <td className="py-1.5 text-foreground">{r.hsn_sac || '—'}</td>
                        <td className="py-1.5 text-right text-muted-foreground">{r.tax_percent}%</td>
                        <td className="py-1.5 text-right text-muted-foreground">₹{r.taxable_value.toLocaleString('en-IN')}</td>
                        <td className="py-1.5 text-right text-foreground">₹{r.cgst.toLocaleString('en-IN')}</td>
                        <td className="py-1.5 text-right text-foreground">₹{r.sgst.toLocaleString('en-IN')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="mt-8">
            <p className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">Invoice register ({report.invoices.length})</p>
            {report.invoices_truncated && (
              <p className="mt-2 rounded-[var(--radius)] bg-warning-subtle px-3 py-2 text-[12.5px] text-warning">
                Showing the most recent 500 of {report.summary.invoices} invoices — narrow the date range to see everything. Summary totals above cover the full range.
              </p>
            )}
            <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-surface p-4">
              {report.invoices.length === 0 ? (
                <p className="text-sm text-muted-foreground">No invoices in this range.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[12px] uppercase tracking-wide text-muted-foreground">
                      <th className="pb-2 font-medium">Invoice #</th>
                      <th className="pb-2 font-medium">Date</th>
                      <th className="pb-2 font-medium">Order</th>
                      <th className="pb-2 text-right font-medium">Taxable value</th>
                      <th className="pb-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {report.invoices.map((i) => (
                      <tr key={i.invoice_number}>
                        <td className="py-1.5 font-mono text-[12.5px] text-foreground">{i.invoice_number}</td>
                        <td className="py-1.5 text-muted-foreground">{formatDate(i.issued_at, timezone)}</td>
                        <td className="py-1.5 text-muted-foreground">#{i.short_code}</td>
                        <td className="py-1.5 text-right text-muted-foreground">₹{i.taxable_value.toLocaleString('en-IN')}</td>
                        <td className="py-1.5 text-right font-medium text-foreground">₹{i.total.toLocaleString('en-IN')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="mt-8">
            <p className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">Credit note register ({report.credit_notes.length})</p>
            {report.credit_notes_truncated && (
              <p className="mt-2 rounded-[var(--radius)] bg-warning-subtle px-3 py-2 text-[12.5px] text-warning">
                Showing the most recent 500 of {report.credit_note_summary.count} credit notes — narrow the date range to see everything. Summary totals above cover the full range.
              </p>
            )}
            <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-surface p-4">
              {report.credit_notes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No credit notes in this range.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[12px] uppercase tracking-wide text-muted-foreground">
                      <th className="pb-2 font-medium">Credit note #</th>
                      <th className="pb-2 font-medium">Date</th>
                      <th className="pb-2 font-medium">Reason</th>
                      <th className="pb-2 text-right font-medium">Taxable value</th>
                      <th className="pb-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {report.credit_notes.map((c) => (
                      <tr key={c.credit_note_number}>
                        <td className="py-1.5 font-mono text-[12.5px] text-foreground">{c.credit_note_number}</td>
                        <td className="py-1.5 text-muted-foreground">{formatDate(c.issued_at, timezone)}</td>
                        <td className="py-1.5 text-muted-foreground">{c.reason}</td>
                        <td className="py-1.5 text-right text-muted-foreground">₹{c.taxable_value.toLocaleString('en-IN')}</td>
                        <td className="py-1.5 text-right font-medium text-destructive">−₹{c.amount.toLocaleString('en-IN')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
