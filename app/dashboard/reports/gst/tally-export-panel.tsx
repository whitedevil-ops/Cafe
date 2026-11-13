'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { useFileExport } from '@/lib/use-file-export'
import {
  buildTallyXml,
  closedBusinessDays,
  rateKey,
  tallyFileName,
  TallyExportError,
  type GstDay,
  type TallyExportResult,
} from '@/lib/tally-export'
import type { GstReport } from './gst-client'

// "Export to Tally" on the GST report. The ledger names are the one thing a
// café has to get right — a single wrong letter or a trailing space is the most
// common reason a Tally import fails — so they are typed once, remembered on
// this device per café, and trimmed before they go in the file.
//
// Everything runs in the browser: each day is one report call straight to the
// database (the same RPC the page already uses), so exporting a month costs the
// hosting plan nothing and no server code is involved.

type Fields = { company: string; party: string; cgst: string; sgst: string; salesReturn: string; salesByRate: Record<string, string> }

const DEFAULT_FIELDS: Fields = {
  company: '',
  party: 'Counter Sales',
  cgst: 'Output CGST',
  sgst: 'Output SGST',
  salesReturn: 'Sales Returns',
  salesByRate: {},
}
const defaultSalesLedger = (key: string) => `Sales GST ${key}%`
const storageKey = (cafeId: string) => `kp_tally_ledgers:${cafeId}`

type Summary = { file: string; days: number; result: TallyExportResult; warnings: string[] }

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const inputClass = 'mt-1 min-h-10 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[16px] text-foreground'

export default function TallyExportPanel({
  cafeId,
  timezone,
  activeRange,
  rates,
}: {
  cafeId: string
  timezone: string
  /** The range currently selected on the page, as ISO instants. */
  activeRange: () => { from: string; to: string }
  /** GST rates present in the report on screen, so their ledgers can be asked for. */
  rates: number[]
}) {
  const { runExport, exporting } = useFileExport()
  const [fields, setFields] = useState<Fields>(DEFAULT_FIELDS)
  const [summary, setSummary] = useState<Summary | null>(null)
  // Stops the "save" effect from overwriting what was stored with the defaults
  // before the stored value has been read back.
  const loaded = useRef(false)

  useEffect(() => {
    try {
      // Read the saved names AFTER mount — localStorage isn't available during
      // SSR, so a lazy initial value would mismatch on hydration.
      const raw = localStorage.getItem(storageKey(cafeId))
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setFields({ ...DEFAULT_FIELDS, ...(JSON.parse(raw) as Partial<Fields>) })
    } catch {
      // Private window or blocked storage: the defaults are fine, the café just retypes.
    }
    loaded.current = true
  }, [cafeId])

  useEffect(() => {
    if (!loaded.current) return
    try {
      localStorage.setItem(storageKey(cafeId), JSON.stringify(fields))
    } catch {
      /* not persisted; nothing else depends on it */
    }
  }, [cafeId, fields])

  const rateKeys = [...new Set([...rates.map(rateKey), ...Object.keys(fields.salesByRate)])].sort((a, b) => Number(a) - Number(b))
  const set = (patch: Partial<Fields>) => setFields((f) => ({ ...f, ...patch }))

  async function exportTally(): Promise<string> {
    const { from, to } = activeRange()
    const days = closedBusinessDays(from, to, timezone)
    if (days.length === 0) {
      throw new TallyExportError('There is no finished day in this range — today is left out until it closes. Choose an earlier range.')
    }

    const supabase = createClient()
    const gstDays: GstDay[] = []
    const warnings: string[] = []
    // A few days at a time: a month is 30 calls and this keeps it to about eight
    // round trips without hammering the database.
    for (let i = 0; i < days.length; i += 4) {
      const batch = await Promise.all(
        days.slice(i, i + 4).map(async (d) => {
          const { data, error } = await supabase.rpc('gst_invoice_report_premium', { p_cafe_id: cafeId, p_from: d.from, p_to: d.to })
          if (error) throw new Error(error.message)
          return { d, report: data as GstReport }
        }),
      )
      for (const { d, report } of batch) {
        if (!report.gst_registered) throw new TallyExportError("This café isn't marked GST-registered, so there are no GST invoices to export.")
        const byTime = [...report.invoices].sort((a, b) => a.issued_at.localeCompare(b.issued_at))
        if (report.invoices_truncated) warnings.push(`${d.date}: more than 500 invoices — the invoice range in the voucher narration is partial (the totals are complete).`)
        if (report.credit_notes_truncated) warnings.push(`${d.date}: more than 500 credit notes — some are missing from the file. Export that day on its own.`)
        gstDays.push({
          date: d.date,
          byRate: report.by_rate,
          invoiceCount: report.summary.invoices,
          firstInvoice: byTime[0]?.invoice_number ?? null,
          lastInvoice: byTime[byTime.length - 1]?.invoice_number ?? null,
          creditNotes: report.credit_notes,
        })
      }
    }

    // A rate that showed up in the range but not on screen (e.g. a custom range
    // that has not been applied yet) has no field. Add it with a suggested name
    // and make the café look at it, instead of guessing a name Tally may not have.
    const unseen = [...new Set(gstDays.flatMap((d) => d.byRate.map((r) => rateKey(r.tax_percent))))].filter((k) => !fields.salesByRate[k]?.trim())
    if (unseen.length > 0) {
      setFields((f) => ({ ...f, salesByRate: { ...Object.fromEntries(unseen.map((k) => [k, defaultSalesLedger(k)])), ...f.salesByRate } }))
      throw new TallyExportError(`GST rate ${unseen.join('%, ')}% needs a Tally ledger. It has been added below with a suggested name — check it matches your Tally, then export again.`)
    }

    const result = buildTallyXml({
      company: fields.company,
      ledgers: { party: fields.party, cgst: fields.cgst, sgst: fields.sgst, salesReturn: fields.salesReturn, salesByRate: fields.salesByRate },
      days: gstDays,
    })
    if (result.vouchers === 0) throw new TallyExportError('There were no GST sales or credit notes on the finished days in this range.')

    const file = tallyFileName(days[0].date, days[days.length - 1].date)
    const blob = new Blob([result.xml], { type: 'application/xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = file
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)

    setSummary({ file, days: days.length, result, warnings: [...warnings, ...result.warnings] })
    return file
  }

  return (
    <details className="mt-6 rounded-xl border border-border bg-surface p-4">
      <summary className="cursor-pointer text-[13px] font-medium uppercase tracking-wide text-muted-foreground">Export to Tally</summary>
      <p className="mt-3 text-[12.5px] text-muted-foreground">
        Writes a TallyPrime import file for the <strong className="font-medium text-foreground">finished days</strong> in the range above: one GST sales voucher per day,
        split by rate, and one credit note per refund. Today is left out until it closes. Receipts by cash, UPI and card are not included yet.
        Type each ledger exactly as it appears in your Tally — spelling, capitals and spaces must match.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-[13px] text-muted-foreground sm:col-span-2">
          Tally company (optional — leave blank to import into whichever company is open)
          <input value={fields.company} onChange={(e) => set({ company: e.target.value })} className={inputClass} />
        </label>
        <label className="block text-[13px] text-muted-foreground">
          Party ledger (counter sales)
          <input value={fields.party} onChange={(e) => set({ party: e.target.value })} className={inputClass} />
        </label>
        <label className="block text-[13px] text-muted-foreground">
          Sales returns ledger
          <input value={fields.salesReturn} onChange={(e) => set({ salesReturn: e.target.value })} className={inputClass} />
        </label>
        <label className="block text-[13px] text-muted-foreground">
          CGST ledger
          <input value={fields.cgst} onChange={(e) => set({ cgst: e.target.value })} className={inputClass} />
        </label>
        <label className="block text-[13px] text-muted-foreground">
          SGST ledger
          <input value={fields.sgst} onChange={(e) => set({ sgst: e.target.value })} className={inputClass} />
        </label>
        {rateKeys.map((k) => (
          <label key={k} className="block text-[13px] text-muted-foreground">
            Sales ledger for {k}% GST
            <input
              value={fields.salesByRate[k] ?? defaultSalesLedger(k)}
              onChange={(e) => set({ salesByRate: { ...fields.salesByRate, [k]: e.target.value } })}
              className={inputClass}
            />
          </label>
        ))}
      </div>

      <button
        onClick={() => void runExport(exportTally)}
        disabled={exporting}
        className="mt-4 min-h-10 rounded-[var(--radius)] bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
      >
        {exporting ? 'Building file…' : 'Download Tally file'}
      </button>

      {summary && (
        <div className="mt-4 rounded-[var(--radius)] border border-border bg-surface-subtle px-3 py-2.5 text-[12.5px] text-muted-foreground">
          <p className="font-medium text-foreground">{summary.file}</p>
          <p className="mt-1">
            {summary.result.salesVouchers} sales voucher{summary.result.salesVouchers === 1 ? '' : 's'} and {summary.result.creditNotes} credit note
            {summary.result.creditNotes === 1 ? '' : 's'} across {summary.days} day{summary.days === 1 ? '' : 's'}. Sales: taxable {inr(summary.result.sales.taxable)}, CGST{' '}
            {inr(summary.result.sales.cgst)}, SGST {inr(summary.result.sales.sgst)}. Refunds: taxable {inr(summary.result.returns.taxable)}, tax{' '}
            {inr(summary.result.returns.cgst + summary.result.returns.sgst)}.
          </p>
          <p className="mt-1">Compare these with the report above, then import in Tally: Gateway of Tally → Import → Vouchers. Try a sample company first.</p>
          {summary.warnings.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-warning">
              {summary.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </details>
  )
}
