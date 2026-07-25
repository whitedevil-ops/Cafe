// Professional .xlsx report generation (client-side download).
//
// Uses ExcelJS, not the `xlsx` package (that one stays for menu-workbook.ts's
// import/export, which reads untrusted files — a different risk profile,
// tracked separately as audit finding F-06). ExcelJS's own CVEs are in its
// zip/glob toolchain (archiver → zip-stream/glob), not reachable from this
// module: we only ever write buffers we constructed ourselves, never parse
// attacker-supplied paths or archives.
//
// Real .xlsx (not CSV renamed): numbers are written as numeric cells so money,
// quantities and percentages stay computable in Excel. User-controlled text is
// guarded against spreadsheet formula injection.
import ExcelJS from 'exceljs'

// A cell that a user could have influenced (item name, notes, category) must not
// be interpreted as a formula by Excel/Sheets. Prefix the dangerous leads.
export function safeText(v: unknown): string {
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

// Brand palette (app/globals.css --primary), as ARGB for ExcelJS fills.
const BRAND = 'FFC2410C'
const BRAND_DARK = 'FF9A3412'
const BAND = 'FFFDECE1'
const GREY_TEXT = 'FF6B7280'
const BORDER = 'FFE5E0DC'

const numFmt: Record<Exclude<Column['kind'], undefined>, string | undefined> = {
  text: undefined,
  money: '#,##0.00',
  qty: '#,##0',
  pct: '0.0"%"',
}

function cellValue(row: Record<string, unknown>, col: Column): string | number {
  const raw = row[col.key]
  if (col.kind === 'money' || col.kind === 'qty' || col.kind === 'pct') {
    if (raw === '' || raw == null) return ''
    const n = Number(raw)
    return Number.isFinite(n) ? n : 0
  }
  return safeText(raw)
}

function buildSheet(wb: ExcelJS.Workbook, spec: SheetSpec, meta: ReportMeta): void {
  const safeName = spec.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)
  const ws = wb.addWorksheet(safeName, { properties: { tabColor: { argb: BRAND } } })
  const colCount = spec.columns.length
  const lastColLetter = ws.getColumn(colCount).letter

  ws.columns = spec.columns.map((c) => ({
    width: Math.max(c.kind && c.kind !== 'text' ? 13 : 12, c.header.length + 2),
  }))

  // ── Title banner (rows 1-5) ────────────────────────────────────────────
  ws.mergeCells(1, 1, 1, colCount)
  const brandCell = ws.getCell(1, 1)
  brandCell.value = 'KhaoPiyo'
  brandCell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 }
  brandCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } }
  brandCell.alignment = { vertical: 'middle' }
  ws.getRow(1).height = 22

  ws.mergeCells(2, 1, 2, colCount)
  const nameCell = ws.getCell(2, 1)
  nameCell.value = safeText(meta.cafeName)
  nameCell.font = { bold: true, size: 15 }
  ws.getRow(2).height = 20

  ws.mergeCells(3, 1, 3, colCount)
  const titleCell = ws.getCell(3, 1)
  titleCell.value = spec.title
  titleCell.font = { bold: true, size: 12, color: { argb: BRAND_DARK } }

  ws.mergeCells(4, 1, 4, colCount)
  ws.getCell(4, 1).value = `Period: ${fmtDate(meta.from)} – ${fmtDate(meta.to)}`
  ws.getCell(4, 1).font = { size: 10, color: { argb: GREY_TEXT } }

  ws.mergeCells(5, 1, 5, colCount)
  ws.getCell(5, 1).value = `Generated: ${new Date().toLocaleString('en-IN')}`
  ws.getCell(5, 1).font = { size: 9, italic: true, color: { argb: GREY_TEXT } }

  // Row 6 blank spacer, row 7 = column headers.
  const headerRow = 7
  const header = ws.getRow(headerRow)
  spec.columns.forEach((c, i) => {
    const cell = header.getCell(i + 1)
    cell.value = c.header
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } }
    cell.alignment = { vertical: 'middle', horizontal: c.kind && c.kind !== 'text' ? 'right' : 'left' }
    cell.border = { top: { style: 'thin', color: { argb: BORDER } }, bottom: { style: 'thin', color: { argb: BORDER } } }
  })
  header.height = 18

  // ── Data rows, zebra-striped ───────────────────────────────────────────
  spec.rows.forEach((row, i) => {
    const r = ws.getRow(headerRow + 1 + i)
    spec.columns.forEach((c, ci) => {
      const cell = r.getCell(ci + 1)
      cell.value = cellValue(row, c)
      if (c.kind && numFmt[c.kind]) cell.numFmt = numFmt[c.kind]!
      cell.alignment = { horizontal: c.kind && c.kind !== 'text' ? 'right' : 'left' }
      if (i % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } }
      cell.border = { bottom: { style: 'hair', color: { argb: BORDER } } }
    })
  })

  const lastDataRow = headerRow + spec.rows.length
  let lastRow = lastDataRow

  if (spec.totals) {
    lastRow = lastDataRow + 1
    const r = ws.getRow(lastRow)
    spec.columns.forEach((c, ci) => {
      const cell = r.getCell(ci + 1)
      cell.value = ci === 0 ? 'TOTAL' : cellValue(spec.totals!, c)
      if (ci !== 0 && c.kind && numFmt[c.kind]) cell.numFmt = numFmt[c.kind]!
      cell.font = { bold: true }
      cell.alignment = { horizontal: c.kind && c.kind !== 'text' ? 'right' : 'left' }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } }
      cell.border = { top: { style: 'medium', color: { argb: BRAND } } }
    })
  }

  // Filter dropdowns on the header row, scoped to the data (not the totals row).
  if (spec.rows.length > 0) {
    ws.autoFilter = { from: `A${headerRow}`, to: `${lastColLetter}${lastDataRow}` }
  }
  // Keep the title banner + header visible while scrolling long reports.
  ws.views = [{ state: 'frozen', ySplit: headerRow }]
}

export async function downloadReport(meta: ReportMeta, sheets: SheetSpec[]): Promise<void> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'KhaoPiyo'
  wb.created = new Date()
  for (const spec of sheets) buildSheet(wb, spec, meta)

  const buf = await wb.xlsx.writeBuffer()
  const stamp = new Date().toISOString().slice(0, 10)
  const file = `KhaoPiyo_${meta.reportName.replace(/[^A-Za-z0-9]+/g, '-')}_${stamp}.xlsx`

  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = file
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// ── Profitability ──────────────────────────────────────────────────────────
type ProfitItem = { name: string; qty: number; sales: number; cost: number; contribution: number; margin_pct: number; has_cost: boolean }
export async function exportProfitabilityXlsx(args: {
  cafeName: string
  summary: { net_sales: number; cost: number; contribution: number; margin_pct: number }
  items: ProfitItem[]
  from: string
  to: string
  type: string
}): Promise<void> {
  const meta: ReportMeta = { cafeName: args.cafeName, reportName: 'Profitability', from: args.from, to: args.to }
  const typeLabel = args.type === 'all' ? 'All order types' : args.type === 'dine_in' ? 'Dine-in' : 'Takeaway'

  await downloadReport(meta, [
    {
      name: 'Profitability',
      title: `Profitability — ${typeLabel}`,
      columns: [
        { header: 'Item', key: 'name', kind: 'text' },
        { header: 'Qty Sold', key: 'qty', kind: 'qty' },
        { header: 'Net Sales (₹)', key: 'sales', kind: 'money' },
        { header: 'Estimated Cost (₹)', key: 'cost', kind: 'money' },
        { header: 'Gross Profit (₹)', key: 'contribution', kind: 'money' },
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
