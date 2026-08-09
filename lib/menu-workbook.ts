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
// Margin, not cost: an owner thinks "I make ₹60 on this burger", not "it
// costs me ₹89". The parser (menu-import.ts) accepts either a Profit or a
// Cost column and derives the other, so an older sheet with Cost columns
// still imports — the sheets we HAND OUT just ask the easier question.
//
// Choices and Add-ons are free text rather than fixed columns, because no
// fixed set of sizes fits every café: one menu's options are Small/Medium/
// Large, the next one's are "6 Slice", "Steam"/"Fried", "3 Slices", "With
// Ice-cream". Each cell lists its own options, one per entry, and the LAST
// number in an entry is its price — so a name can itself contain digits.
// Choices are the full price of that option; add-ons are what they ADD,
// which is exactly how a printed menu board writes them.
export const OPTION_SYNTAX_HINT = 'Name Price, separated by commas — e.g. "Steam 69, Fried 79". Add "/margin" for costing: "Steam 69/20".'

const TEMPLATE_HEADER = ['Category / Item', 'Price', 'Margin', 'Choices (pick one)', 'Add-ons (extras)', 'Veg Type', 'Description']
const TEMPLATE_COLS = [{ wch: 26 }, { wch: 8 }, { wch: 8 }, { wch: 30 }, { wch: 26 }, { wch: 10 }, { wch: 34 }]

export function downloadMenuTemplate(cafeName: string) {
  const rows: (string | number)[][] = [
    TEMPLATE_HEADER,
    ['BURGERS', '', '', '', '', '', ''],
    ['Classic Veg Burger', 149, 60, '', 'Cheese Slice 20', 'Veg', 'Margin = what you keep after making it'],
    ['Cheese Burger', 179, 75, '', '', 'Veg', 'No options — leave both option columns blank'],
    ['PIZZA', '', '', '', '', '', ''],
    ['Margherita', 99, '', '6 Slice 99, 8 Slice 139', 'Double Cheese 40', 'Veg', 'Choices = the full price of that option'],
    ['MOMOS', '', '', '', '', '', ''],
    ['Veg Momos', '', '', 'Steam 69, Fried 79', '', 'Veg', 'No Price needed — the first choice becomes the price'],
    ['COLD DRINKS', '', '', '', '', '', ''],
    ['Cold Coffee', 59, 25, '', 'With Ice-cream 29', 'Veg', 'Add-ons = what they ADD to the price'],
    ['Coca Cola', 60, 25, '', '', 'Veg', ''],
  ]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = TEMPLATE_COLS
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
  /** Every choice this item offers, as absolute prices — free-form names, so
      "6 Slice" and "Steam" round-trip as faithfully as "Small". */
  choices?: { name: string; price: number; cost: number | null }[]
  /** Every optional extra, as the amount it ADDS. */
  addons?: { name: string; price: number }[]
}

/** "Steam 69, Fried 79/25" — the exact syntax parseOptionList reads back. */
function optionCell(opts: { name: string; price: number; cost?: number | null }[] | undefined): string {
  if (!opts?.length) return ''
  return opts
    .map((o) => {
      const margin = o.cost != null ? o.price - o.cost : null
      // Names are user text going into a cell the importer re-splits, so a
      // comma inside one would silently fork it into two options. Swapping it
      // for a space is lossy but harmless; losing the option isn't.
      const name = o.name.replace(/[,;\n]/g, ' ').replace(/\s+/g, ' ').trim()
      return margin != null ? `${name} ${o.price}/${margin}` : `${name} ${o.price}`
    })
    .join(', ')
}

// Flat/repeated-category shape — safe to sort, filter, and bulk-edit in Excel
// without breaking category grouping, then re-import without duplicating. That
// property is why choices and add-ons are cells rather than extra rows: rows
// would detach from their item the first time anyone sorted by price.
export function downloadMenuExport(cafeName: string, rows: ExportRow[]) {
  const header = ['Category', 'Item', 'Price', 'Margin', 'Choices (pick one)', 'Add-ons (extras)', 'Veg Type', 'Description']
  const body = rows.map((r) => [
    safeText(r.category),
    safeText(r.name),
    r.price,
    r.cost != null ? r.price - r.cost : '',
    safeText(optionCell(r.choices)),
    safeText(optionCell(r.addons)),
    r.isVeg === true ? 'Veg' : r.isVeg === false ? 'Non-Veg' : '',
    safeText(r.description ?? ''),
  ])
  const ws = XLSX.utils.aoa_to_sheet([header, ...body])
  ws['!cols'] = [{ wch: 20 }, { wch: 26 }, { wch: 8 }, { wch: 8 }, { wch: 30 }, { wch: 26 }, { wch: 10 }, { wch: 34 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Menu')
  download(wb, `${cafeName || 'cafe'}-menu-export.xlsx`.replace(/\s+/g, '-'))
}

export type ComboExportRow = {
  combo: string
  comboPrice: number
  /** Owner's own margin figure. Never shown to a customer. */
  comboMargin: number | null
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
  const header = ['Combo', 'Combo Price', 'Margin', 'Status', 'Includes', 'Type', 'Item / Category', 'Size', 'Qty', 'Unit Price', 'Line Total']
  const body = rows.map((r) => [
    safeText(r.combo),
    r.comboPrice,
    r.comboMargin ?? '',
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
  const totals = new Map<string, { price: number; margin: number | null; fixed: number; hasChoice: boolean }>()
  for (const r of rows) {
    const t = totals.get(r.combo) ?? { price: r.comboPrice, margin: r.comboMargin, fixed: 0, hasChoice: false }
    if (r.unitPrice != null) t.fixed += r.unitPrice * r.qty
    else t.hasChoice = true
    totals.set(r.combo, t)
  }
  const summary: (string | number)[][] = [
    [],
    ['Combo', 'Combo Price', 'Your margin', 'Menu value of fixed items', 'Note'],
    ...[...totals.entries()].map(([name, t]) => [
      safeText(name),
      t.price,
      t.margin ?? '',
      t.fixed,
      t.hasChoice ? 'Plus whatever the guest chooses' : `Saving vs. separately: ₹${Math.max(0, t.fixed - t.price)}`,
    ]),
  ]

  const ws = XLSX.utils.aoa_to_sheet([header, ...body, ...summary])
  ws['!cols'] = [{ wch: 24 }, { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 24 }, { wch: 15 }, { wch: 26 }, { wch: 10 }, { wch: 6 }, { wch: 11 }, { wch: 11 }]
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
