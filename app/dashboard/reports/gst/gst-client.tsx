'use client'

import Link from 'next/link'
import { formatDate } from '@/lib/datetime'
import { downloadReport, type SheetSpec } from '@/lib/xlsx-export'
import { ReportsSubnav, ReportHeader, RangePicker, useReportRange } from '../_shared'

export type GstReport = {
  gst_registered: boolean
  summary: { invoices: number; taxable_value: number; tax: number; cgst: number; sgst: number }
  by_rate: { hsn_sac: string; tax_percent: number; taxable_value: number; cgst: number; sgst: number; tax: number }[]
  invoices: { invoice_number: string; issued_at: string; short_code: string; taxable_value: number; tax: number; cgst: number; sgst: number; total: number }[]
}

export default function GstClient({
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
  initialReport: GstReport | null
}) {
  const canSeeProfit = role === 'owner' || role === 'manager'
  const { report, loading, error, preset, choosePreset, customFrom, setCustomFrom, customTo, setCustomTo, applyCustom, activeRange } =
    useReportRange<GstReport>({ cafeId, timezone, rpc: 'gst_invoice_report', initialFrom, initialTo, initialReport })

  function exportExcel() {
    if (!report) return
    const { from, to } = activeRange()
    const sheets: SheetSpec[] = [
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
    ]
    downloadReport({ cafeName, reportName: 'GST', from, to }, sheets)
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
              <p className="text-[12.5px] text-muted-foreground">Taxable value</p>
              <p className="mt-1 text-xl font-semibold tracking-tight text-foreground">₹{report.summary.taxable_value.toLocaleString('en-IN')}</p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[12.5px] text-muted-foreground">CGST</p>
              <p className="mt-1 text-xl font-semibold tracking-tight text-foreground">₹{report.summary.cgst.toLocaleString('en-IN')}</p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[12.5px] text-muted-foreground">SGST</p>
              <p className="mt-1 text-xl font-semibold tracking-tight text-foreground">₹{report.summary.sgst.toLocaleString('en-IN')}</p>
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
        </>
      )}
    </div>
  )
}
