import * as XLSX from 'xlsx'
import { safeText } from './xlsx-export'

function download(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename)
}

// The blank starting template — heading style, exactly the shape a
// non-technical owner can fill in by typing a category name, then item rows
// underneath, repeating. Pre-filled with the worked example so it's obvious
// how it works on first open, not just a bare header row.
//
// Small/Medium/Large are optional — only fill them in for an item that
// actually comes in multiple sizes (like Cold Coffee below); leave all three
// blank for a single-price item (like the burgers below) and Price alone is
// used, exactly as before these columns existed. Whichever size columns are
// filled become that item's size options — Price can be left blank too, in
// which case the first filled size becomes the item's listed price.
//
// Each size's own Cost column is optional independently of both the size
// price and the item's own Profit column — leave it blank if a size doesn't
// cost anything different to make.
export function downloadMenuTemplate(cafeName: string) {
  const rows: (string | number)[][] = [
    ['Category / Item', 'Price', 'Small', 'Small Cost', 'Medium', 'Medium Cost', 'Large', 'Large Cost', 'Profit', 'Veg Type', 'Description'],
    ['BURGERS', '', '', '', '', '', '', '', '', '', ''],
    ['Classic Veg Burger', 149, '', '', '', '', '', '', 89, 'Veg', 'Classic vegetable burger'],
    ['Cheese Burger', 179, '', '', '', '', '', '', 104, 'Veg', 'Burger with cheese'],
    ['COLD DRINKS', '', '', '', '', '', '', '', '', '', ''],
    ['Cold Coffee', '', 80, 30, 110, '', 130, 55, '', 'Veg', 'Only fill sizes/size-costs that apply — the rest can stay blank'],
    ['Coca Cola', 60, '', '', '', '', '', '', 35, 'Veg', ''],
  ]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 26 }, { wch: 9 }, { wch: 9 }, { wch: 10 }, { wch: 9 }, { wch: 11 }, { wch: 9 }, { wch: 10 }, { wch: 9 }, { wch: 12 }, { wch: 34 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Menu template')
  download(wb, `${cafeName || 'cafe'}-menu-template.xlsx`.replace(/\s+/g, '-'))
}

export type ExportRow = {
  category: string
  name: string
  price: number
  cost: number | null
  isVeg: boolean | null
  description: string | null
  /** Absolute prices (and optional absolute costs) for any Small/Medium/Large
      variant this item has — round-trips size options back through
      Export → edit → re-import. */
  sizes?: {
    small?: number; smallCost?: number
    medium?: number; mediumCost?: number
    large?: number; largeCost?: number
  }
}

// Flat/repeated-category shape — safe to sort, filter, and bulk-edit in Excel
// without breaking category grouping, then re-import without duplicating.
export function downloadMenuExport(cafeName: string, rows: ExportRow[]) {
  const header = ['Category', 'Item', 'Price', 'Small', 'Small Cost', 'Medium', 'Medium Cost', 'Large', 'Large Cost', 'Profit', 'Veg Type', 'Description']
  const body = rows.map((r) => [
    safeText(r.category),
    safeText(r.name),
    r.price,
    r.sizes?.small ?? '',
    r.sizes?.smallCost ?? '',
    r.sizes?.medium ?? '',
    r.sizes?.mediumCost ?? '',
    r.sizes?.large ?? '',
    r.sizes?.largeCost ?? '',
    r.cost != null ? r.price - r.cost : '',
    r.isVeg === true ? 'Veg' : r.isVeg === false ? 'Non-Veg' : '',
    safeText(r.description ?? ''),
  ])
  const ws = XLSX.utils.aoa_to_sheet([header, ...body])
  ws['!cols'] = [{ wch: 20 }, { wch: 26 }, { wch: 9 }, { wch: 9 }, { wch: 10 }, { wch: 9 }, { wch: 11 }, { wch: 9 }, { wch: 10 }, { wch: 9 }, { wch: 12 }, { wch: 34 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Menu')
  download(wb, `${cafeName || 'cafe'}-menu-export.xlsx`.replace(/\s+/g, '-'))
}

export type ComboExportRow = {
  combo: string
  comboPrice: number
  active: boolean
  /** The slot's label as printed on the menu board — "Any Pizza". */
  label: string
  kind: 'fixed' | 'choice'
  /** Item name for a fixed slot; category name for a choice slot. */
  target: string
  size: string | null
  qty: number
  /** Unit price for a fixed slot. Null for a choice — it varies by pick. */
  unitPrice: number | null
}

// One row per combo row (slot), with the combo's own name/price repeated —
// the same flat shape as the menu export, for the same reason: an owner can
// sort and filter it in Excel without the grouping falling apart.
//
// Export only, deliberately: a combo's rows reference specific menu items and
// categories by identity, so a re-import would have to resolve names back to
// ids and silently guess when one didn't match. Building a combo is a handful
// of dropdowns in Menu → Combos; the spreadsheet is for reviewing pricing and
// sharing it, not for round-tripping.
export function downloadCombosExport(cafeName: string, rows: ComboExportRow[]) {
  const header = ['Combo', 'Combo Price', 'Status', 'Includes', 'Type', 'Item / Category', 'Size', 'Qty', 'Unit Price', 'Line Total']
  const body = rows.map((r) => [
    safeText(r.combo),
    r.comboPrice,
    r.active ? 'Live' : 'Off',
    safeText(r.label),
    r.kind === 'fixed' ? 'Specific item' : 'Guest chooses',
    safeText(r.target),
    safeText(r.size ?? ''),
    r.qty,
    r.unitPrice ?? '',
    r.unitPrice != null ? r.unitPrice * r.qty : '',
  ])

  // Per-combo parts total vs. the combo price — the number an owner actually
  // wants from this sheet ("what am I giving away?"). Only counts fixed rows;
  // a choice row's price depends on what the guest picks.
  const totals = new Map<string, { price: number; fixed: number; hasChoice: boolean }>()
  for (const r of rows) {
    const t = totals.get(r.combo) ?? { price: r.comboPrice, fixed: 0, hasChoice: false }
    if (r.unitPrice != null) t.fixed += r.unitPrice * r.qty
    else t.hasChoice = true
    totals.set(r.combo, t)
  }
  const summary: (string | number)[][] = [
    [],
    ['Combo', 'Combo Price', 'Fixed items cost', 'Note'],
    ...[...totals.entries()].map(([name, t]) => [
      safeText(name),
      t.price,
      t.fixed,
      t.hasChoice ? 'Plus whatever the guest chooses' : `Saving vs. separately: ₹${Math.max(0, t.fixed - t.price)}`,
    ]),
  ]

  const ws = XLSX.utils.aoa_to_sheet([header, ...body, ...summary])
  ws['!cols'] = [{ wch: 24 }, { wch: 12 }, { wch: 8 }, { wch: 24 }, { wch: 15 }, { wch: 26 }, { wch: 10 }, { wch: 6 }, { wch: 11 }, { wch: 11 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Combos')
  download(wb, `${cafeName || 'cafe'}-combos.xlsx`.replace(/\s+/g, '-'))
}

// Reads an uploaded .csv or .xlsx File into a plain array-of-arrays, the input
// shape parseMenuFile expects — one place that understands the file format,
// so the parser itself stays format-agnostic.
export async function readWorkbookRows(file: File): Promise<unknown[][]> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][]
}
