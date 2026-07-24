// Professional .xlsx report generation (client-side download).
//
// Uses SheetJS (already a project dependency). NOTE ON SECURITY: SheetJS's known
// CVEs (prototype pollution, ReDoS) are on the PARSE path — reading untrusted
// spreadsheets. This module only WRITES workbooks from our own trusted RPC data,
// which is unaffected. (Import parsing — the risky path — is tracked separately
// as audit finding F-06.)
//
// Real .xlsx (not CSV renamed): numbers are written as numeric cells so money,
// quantities and percentages stay computable in Excel. User-controlled text is
// guarded against spreadsheet formula injection.
import * as XLSX from 'xlsx'

// A cell that a user could have influenced (item name, notes, category) must not
// be interpreted as a formula by Excel/Sheets. Prefix the dangerous leads.
function safeText(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
}

export type Column = { header: string; key: string; kind?: 'text' | 'money' | 'qty' | 'pct' }
export type SheetSpec = {
  name: string
  title: string
  columns: Column[]
  rows: Record<string, unknown>[]
  /** Optional trailing totals row (already computed). */
  totals?: Record<string, unknown>
}

export type ReportMeta = {
  cafeName: string
  reportName: string
  from: string // ISO
  to: string // ISO
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Build one worksheet as an array-of-arrays: a header block, a blank line, the
// column headers, the data, and (optionally) a totals row.
function sheetToAoa(spec: SheetSpec, meta: ReportMeta): (string | number)[][] {
  const aoa: (string | number)[][] = []
  aoa.push(['KhaoPiyo'])
  aoa.push([safeText(meta.cafeName)])
  aoa.push([spec.title])
  aoa.push([`Period: ${fmtDate(meta.from)} – ${fmtDate(meta.to)}`])
  aoa.push([`Generated: ${new Date().toLocaleString('en-IN')}`])
  aoa.push([])
  aoa.push(spec.columns.map((c) => c.header))

  const cell = (row: Record<string, unknown>, col: Column): string | number => {
    const raw = row[col.key]
    if (col.kind === 'money' || col.kind === 'qty' || col.kind === 'pct') {
      const n = Number(raw)
      return Number.isFinite(n) ? n : 0
    }
    return safeText(raw)
  }

  for (const row of spec.rows) aoa.push(spec.columns.map((c) => cell(row, c)))
  if (spec.totals) aoa.push(spec.columns.map((c) => (c === spec.columns[0] ? 'TOTAL' : cell(spec.totals!, c))))
  return aoa
}

export function downloadReport(meta: ReportMeta, sheets: SheetSpec[]): void {
  const wb = XLSX.utils.book_new()
  for (const spec of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(sheetToAoa(spec, meta))
    // Reasonable column widths from header length.
    ws['!cols'] = spec.columns.map((c) => ({ wch: Math.max(12, c.header.length + 2) }))
    // Sheet names: <=31 chars, no illegal chars.
    const safeName = spec.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)
    XLSX.utils.book_append_sheet(wb, ws, safeName)
  }
  const stamp = new Date().toISOString().slice(0, 10)
  const file = `KhaoPiyo_${meta.reportName.replace(/[^A-Za-z0-9]+/g, '-')}_${stamp}.xlsx`
  XLSX.writeFile(wb, file)
}

// ── Profitability ──────────────────────────────────────────────────────────
type ProfitItem = { name: string; qty: number; sales: number; cost: number; contribution: number; margin_pct: number; has_cost: boolean }
export function exportProfitabilityXlsx(args: {
  cafeName: string
  summary: { net_sales: number; cost: number; contribution: number; margin_pct: number }
  items: ProfitItem[]
  from: string
  to: string
  type: string
}): void {
  const meta: ReportMeta = { cafeName: args.cafeName, reportName: 'Profitability', from: args.from, to: args.to }
  const typeLabel = args.type === 'all' ? 'All order types' : args.type === 'dine_in' ? 'Dine-in' : 'Takeaway'

  downloadReport(meta, [
    {
      name: 'Profitability',
      title: `Profitability — ${typeLabel}`,
      columns: [
        { header: 'Item', key: 'name', kind: 'text' },
        { header: 'Qty Sold', key: 'qty', kind: 'qty' },
        { header: 'Net Sales (₹)', key: 'sales', kind: 'money' },
        { header: 'Estimated Cost (₹)', key: 'cost', kind: 'money' },
        { header: 'Gross Contribution (₹)', key: 'contribution', kind: 'money' },
        { header: 'Margin %', key: 'margin_pct', kind: 'pct' },
      ],
      rows: args.items.map((i) => ({
        name: i.name,
        qty: i.qty,
        sales: i.sales,
        cost: i.has_cost ? i.cost : '',
        contribution: i.contribution,
        margin_pct: i.has_cost ? i.margin_pct : '',
      })),
      totals: {
        qty: args.items.reduce((s, i) => s + i.qty, 0),
        sales: args.summary.net_sales,
        cost: args.summary.cost,
        contribution: args.summary.contribution,
        margin_pct: args.summary.margin_pct,
      },
    },
  ])
}
