// Turns the GST report into a TallyPrime voucher-import file (XML).
//
// WHAT IT PRODUCES, per closed business day:
//   - ONE Sales voucher: debits a single "party" ledger for the day's gross
//     (taxable + CGST + SGST); credits a sales ledger per GST rate for the
//     taxable value, and the CGST / SGST ledgers for the tax. One voucher a
//     day, not one per bill: a café issues hundreds of invoices a day and the
//     accountant wants the day's totals by rate, which is what GSTR-1's B2C
//     summary asks for anyway.
//   - ONE Credit Note voucher per GST credit note (refund): the mirror image,
//     debiting a sales-returns ledger and the tax ledgers, crediting the party.
//
// WHAT IT DELIBERATELY DOES NOT DO: payments / receipts by mode (cash, UPI,
// card), expenses, stock. The party ledger therefore carries the day's
// receivable until the accountant (or a later version) books the receipts.
//
// THE FILE IS BALANCED BY CONSTRUCTION: the party amount is the sum of the
// other entries in integer paise, never an independent figure, so a voucher
// cannot fail Tally's "Voucher totals do not match" check because of rounding.
// The cost is that it can differ by a rupee or two from an invoice's printed
// total (the bill's own round-off is not exported).
//
// UNVERIFIED AGAINST A REAL TALLY: the tag set below follows Tally's published
// import format as far as its documentation could be read, and the debit/
// credit sign convention (debit = ISDEEMEDPOSITIVE Yes with a NEGATIVE amount,
// credit = No with a positive amount) is Tally's standard, but no document
// confirmed every tag for a GST sales voucher. Try a file on a sample company
// before importing real books — see docs/tally-export.md.

import { businessDayKey, businessDayStart } from '@/lib/datetime'

export type TallyLedgers = {
  /** Debited by each sales voucher, credited by each credit note — the
   *  counter-sales / cash-sales ledger in the café's Tally. */
  party: string
  /** Sales ledger per GST rate, keyed by the rate as Number() prints it:
   *  "5", "18", "2.5". See `rateKey`. */
  salesByRate: Record<string, string>
  cgst: string
  sgst: string
  /** Debited by credit notes for the taxable value of the refund. */
  salesReturn: string
}

/** One closed business day of the GST report, already narrowed to the fields
 *  the export needs (the UI maps the RPC's JSON onto this). */
export type GstDay = {
  /** Café-local calendar date, "YYYY-MM-DD". */
  date: string
  byRate: { tax_percent: number; taxable_value: number; cgst: number; sgst: number }[]
  invoiceCount: number
  firstInvoice: string | null
  lastInvoice: string | null
  creditNotes: {
    credit_note_number: string
    taxable_value: number
    cgst: number
    sgst: number
    /** What the customer was actually refunded — compared with the tax-inclusive
     *  total only to raise a warning, never used as a voucher amount. */
    amount: number
    reason: string
  }[]
}

export type TallyExportResult = {
  xml: string
  vouchers: number
  salesVouchers: number
  creditNotes: number
  /** Things the accountant should look at; the file is still valid. */
  warnings: string[]
  sales: { taxable: number; cgst: number; sgst: number }
  returns: { taxable: number; cgst: number; sgst: number }
}

/** A problem the café can fix (a ledger left blank, a range that is too wide),
 *  as opposed to a bug. The UI shows its message as is. */
export class TallyExportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TallyExportError'
  }
}

/** The key a GST rate is stored under in `TallyLedgers.salesByRate`. */
export function rateKey(taxPercent: number): string {
  return String(Number(taxPercent))
}

// ── money ───────────────────────────────────────────────────────────────────
// Everything is summed as integer paise and only turned back into "123.45" at
// the very end, so no float ever decides whether a voucher balances.

const toPaise = (rupees: number): number => Math.round(Number(rupees) * 100)

function formatPaise(paise: number): string {
  const sign = paise < 0 ? '-' : ''
  const abs = Math.abs(paise)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

// ── XML ─────────────────────────────────────────────────────────────────────

// Control characters other than tab / newline / carriage return are illegal in
// XML 1.0 and make Tally reject the whole file, not just one voucher.
const ILLEGAL_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g

function esc(value: string): string {
  return value
    .replace(ILLEGAL_XML_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

type Entry = { ledger: string; paise: number; debit: boolean; party?: boolean }

function entryXml(e: Entry): string {
  // Tally's convention: a debit is flagged "deemed positive" and carries a
  // NEGATIVE amount; a credit is not flagged and carries a positive one.
  return [
    '<LEDGERENTRIES.LIST>',
    `<LEDGERNAME>${esc(e.ledger)}</LEDGERNAME>`,
    `<ISDEEMEDPOSITIVE>${e.debit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>`,
    e.party ? '<ISPARTYLEDGER>Yes</ISPARTYLEDGER>' : '',
    `<AMOUNT>${formatPaise(e.debit ? -e.paise : e.paise)}</AMOUNT>`,
    '</LEDGERENTRIES.LIST>',
  ].join('')
}

function voucherXml(args: { type: 'Sales' | 'Credit Note'; number: string; date: string; narration: string; party: string; entries: Entry[] }): string {
  const debit = args.entries.filter((e) => e.debit).reduce((s, e) => s + e.paise, 0)
  const credit = args.entries.filter((e) => !e.debit).reduce((s, e) => s + e.paise, 0)
  // Unreachable while the callers build the party entry from the rest — kept so
  // a future edit that breaks the balance fails loudly here, in our code and
  // our tests, instead of as an opaque import error inside the accountant's Tally.
  if (debit !== credit) throw new Error(`voucher ${args.number} does not balance: Dr ${debit} vs Cr ${credit}`)

  return [
    '<TALLYMESSAGE xmlns:UDF="TallyUDF">',
    `<VOUCHER VCHTYPE="${args.type}" ACTION="Create" OBJVIEW="Accounting Voucher View">`,
    `<DATE>${args.date.replace(/-/g, '')}</DATE>`,
    `<VOUCHERTYPENAME>${args.type}</VOUCHERTYPENAME>`,
    `<VOUCHERNUMBER>${esc(args.number)}</VOUCHERNUMBER>`,
    `<PARTYLEDGERNAME>${esc(args.party)}</PARTYLEDGERNAME>`,
    '<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>',
    '<ISINVOICE>No</ISINVOICE>',
    `<NARRATION>${esc(args.narration)}</NARRATION>`,
    ...args.entries.map(entryXml),
    '</VOUCHER>',
    '</TALLYMESSAGE>',
  ].join('\n')
}

// ── the export ──────────────────────────────────────────────────────────────

function requireLedger(label: string, value: string): string {
  const v = value.trim()
  if (!v) throw new TallyExportError(`Enter the Tally ledger name for ${label}.`)
  return v
}

export function buildTallyXml(input: { company?: string; ledgers: TallyLedgers; days: GstDay[] }): TallyExportResult {
  const party = requireLedger('the party (counter sales) ledger', input.ledgers.party)
  const cgst = requireLedger('CGST', input.ledgers.cgst)
  const sgst = requireLedger('SGST', input.ledgers.sgst)
  const salesReturn = requireLedger('sales returns', input.ledgers.salesReturn)

  const warnings: string[] = []
  const messages: string[] = []
  const sales = { taxable: 0, cgst: 0, sgst: 0 }
  const returns = { taxable: 0, cgst: 0, sgst: 0 }
  let salesVouchers = 0
  let creditNotes = 0

  for (const day of input.days) {
    // Several HSN/SAC codes can share a rate; Tally's sales ledger is per rate.
    const perRate = new Map<string, { rate: number; taxable: number; cgst: number; sgst: number }>()
    for (const r of day.byRate) {
      const key = rateKey(r.tax_percent)
      const row = perRate.get(key) ?? { rate: Number(r.tax_percent), taxable: 0, cgst: 0, sgst: 0 }
      row.taxable += toPaise(r.taxable_value)
      row.cgst += toPaise(r.cgst)
      row.sgst += toPaise(r.sgst)
      perRate.set(key, row)
    }

    const entries: Entry[] = []
    let dayCgst = 0
    let daySgst = 0
    let dayTaxable = 0
    for (const [key, row] of [...perRate.entries()].sort((a, b) => a[1].rate - b[1].rate)) {
      if (row.taxable === 0 && row.cgst === 0 && row.sgst === 0) continue
      const ledger = (input.ledgers.salesByRate[key] ?? '').trim()
      if (!ledger) throw new TallyExportError(`Enter the Tally sales ledger for the ${key}% GST rate (it appears on ${day.date}).`)
      entries.push({ ledger, paise: row.taxable, debit: false })
      dayTaxable += row.taxable
      dayCgst += row.cgst
      daySgst += row.sgst
    }
    if (dayCgst) entries.push({ ledger: cgst, paise: dayCgst, debit: false })
    if (daySgst) entries.push({ ledger: sgst, paise: daySgst, debit: false })

    if (entries.length === 0) {
      if (day.invoiceCount > 0) warnings.push(`${day.date}: ${day.invoiceCount} invoices but no tax breakdown was returned, so no sales voucher was written for that day.`)
    } else {
      const gross = dayTaxable + dayCgst + daySgst
      const range = day.invoiceCount > 1 && day.firstInvoice && day.lastInvoice ? ` ${day.firstInvoice} to ${day.lastInvoice}` : day.firstInvoice ? ` ${day.firstInvoice}` : ''
      messages.push(
        voucherXml({
          type: 'Sales',
          number: `KP-GST-${day.date.replace(/-/g, '')}`,
          date: day.date,
          narration: `KhaoPiyo GST sales ${day.date}: ${day.invoiceCount} invoice${day.invoiceCount === 1 ? '' : 's'}${range}`,
          party,
          entries: [{ ledger: party, paise: gross, debit: true, party: true }, ...entries],
        }),
      )
      salesVouchers++
      sales.taxable += dayTaxable
      sales.cgst += dayCgst
      sales.sgst += daySgst
    }

    for (const cn of day.creditNotes) {
      const taxable = toPaise(cn.taxable_value)
      const cnCgst = toPaise(cn.cgst)
      const cnSgst = toPaise(cn.sgst)
      const gross = taxable + cnCgst + cnSgst
      if (gross === 0) {
        warnings.push(`Credit note ${cn.credit_note_number} has no value and was skipped.`)
        continue
      }
      // The refund the customer received should equal taxable + tax; a larger
      // gap than rounding means the credit note was split unevenly across rates.
      if (Math.abs(toPaise(cn.amount) - gross) > 100) {
        warnings.push(`Credit note ${cn.credit_note_number}: refunded ₹${cn.amount} but taxable value + tax is ₹${formatPaise(gross)}; the file uses the latter.`)
      }
      const cnEntries: Entry[] = [{ ledger: salesReturn, paise: taxable, debit: true }]
      if (cnCgst) cnEntries.push({ ledger: cgst, paise: cnCgst, debit: true })
      if (cnSgst) cnEntries.push({ ledger: sgst, paise: cnSgst, debit: true })
      cnEntries.push({ ledger: party, paise: gross, debit: false, party: true })
      messages.push(
        voucherXml({
          type: 'Credit Note',
          number: cn.credit_note_number,
          date: day.date,
          narration: `KhaoPiyo refund credit note${cn.reason ? `: ${cn.reason}` : ''}`,
          party,
          entries: cnEntries,
        }),
      )
      creditNotes++
      returns.taxable += taxable
      returns.cgst += cnCgst
      returns.sgst += cnSgst
    }
  }

  const company = (input.company ?? '').trim()
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ENVELOPE>',
    '<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>',
    '<BODY>',
    '<IMPORTDATA>',
    '<REQUESTDESC>',
    '<REPORTNAME>Vouchers</REPORTNAME>',
    // Without a company Tally imports into whichever one is open — correct for
    // an accountant who opened the right books, risky otherwise.
    company ? `<STATICVARIABLES><SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY></STATICVARIABLES>` : '',
    '</REQUESTDESC>',
    '<REQUESTDATA>',
    ...messages,
    '</REQUESTDATA>',
    '</IMPORTDATA>',
    '</BODY>',
    '</ENVELOPE>',
  ]
    .filter(Boolean)
    .join('\n')

  const rupees = (p: number) => p / 100
  return {
    xml,
    vouchers: salesVouchers + creditNotes,
    salesVouchers,
    creditNotes,
    warnings,
    sales: { taxable: rupees(sales.taxable), cgst: rupees(sales.cgst), sgst: rupees(sales.sgst) },
    returns: { taxable: rupees(returns.taxable), cgst: rupees(returns.cgst), sgst: rupees(returns.sgst) },
  }
}

// ── which days to export ────────────────────────────────────────────────────

export const MAX_EXPORT_DAYS = 92

export type ExportDay = { date: string; from: string; to: string }

/**
 * The FINISHED business days inside [fromISO, toISO), in the café's own
 * timezone. Today is left out on purpose: a voucher for a day still in
 * progress would be written, imported, and then be wrong by closing time —
 * and importing the corrected one later would double it in Tally.
 */
export function closedBusinessDays(fromISO: string, toISO: string, timeZone: string, now: Date = new Date()): ExportDay[] {
  const end = new Date(toISO).getTime()
  const days: ExportDay[] = []
  let start = businessDayStart(timeZone, new Date(fromISO))

  while (start.getTime() < end) {
    // Local noon of the next day, then re-resolve that date's midnight, so a
    // 23- or 25-hour day around a DST change cannot skip or repeat a date.
    const next = businessDayStart(timeZone, new Date(start.getTime() + 36 * 3600_000))
    if (next.getTime() > now.getTime()) break
    days.push({ date: businessDayKey(start, timeZone), from: start.toISOString(), to: next.toISOString() })
    if (days.length > MAX_EXPORT_DAYS) throw new TallyExportError(`Choose a range of up to ${MAX_EXPORT_DAYS} days.`)
    start = next
  }
  return days
}

export function tallyFileName(fromKey: string, toKey: string): string {
  return fromKey === toKey ? `KhaoPiyo_Tally_GST_${fromKey}.xml` : `KhaoPiyo_Tally_GST_${fromKey}_to_${toKey}.xml`
}
