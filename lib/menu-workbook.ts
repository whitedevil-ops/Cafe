import * as XLSX from 'xlsx'
import { safeText } from './xlsx-export'

function download(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename)
}

// The blank starting template — heading style, exactly the shape a
// non-technical owner can fill in by typing a category name, then item rows
// underneath, repeating. Pre-filled with a worked example so it's obvious how
// it works on first open, not just a bare header row.
//
// Two sheets, and the split matters. The Menu sheet holds nothing but data;
// every word of explanation lives on a second "How to fill this in" sheet.
// Instructions used to sit in the Menu sheet's Description cells, which import
// like any other description — so a café that filled in the template and
// imported it published "Margin = what you keep after making it" as the text
// under Coca Cola on the customer menu. Only the FIRST sheet is ever read
// (readWorkbookRows), so the guide can never be mistaken for menu data.
//
// Margin, not cost: an owner thinks "I make ₹60 on this burger", not "it
// costs me ₹89". The parser (menu-import.ts) accepts either a Profit or a
// Cost column and derives the other, so an older sheet with Cost columns
// still imports — the sheets we HAND OUT just ask the easier question.
//
// Sizes/Choices and Add-ons are free text rather than fixed columns, because
// no fixed set of sizes fits every café: one menu's options are Small/Medium/
// Large, the next one's are "6 Slice", "Steam"/"Fried", "3 Slices", "With
// Ice-cream". Each cell lists its own options, one per entry, and the LAST
// number in an entry is its price — so a name can itself contain digits.
// Choices are the full price of that option; add-ons are what they ADD,
// which is exactly how a printed menu board writes them.

const TEMPLATE_HEADER = ['Category / Item', 'Price', 'Margin', 'Sizes / Choices', 'Add-ons', 'Veg Type', 'Description']
const TEMPLATE_COLS = [{ wch: 26 }, { wch: 8 }, { wch: 8 }, { wch: 32 }, { wch: 24 }, { wch: 10 }, { wch: 38 }]

// Plain language, one idea per line, no jargon. Read top to bottom.
const GUIDE_ROWS: string[][] = [
  ['How to fill in your menu'],
  ['Type everything on the "Menu" tab. This tab is only notes — nothing here is imported.'],
  [''],
  ['THE BASIC IDEA'],
  ['1.', 'Type a category name on its own row, like BURGERS. Leave the rest of that row empty.'],
  ['2.', 'List that category\'s items underneath it, one per row, with a price.'],
  ['3.', 'Start the next category the same way. Blank rows are fine.'],
  ['4.', 'Replace our example rows with your own before you import.'],
  [''],
  ['WHAT EACH COLUMN IS FOR'],
  ['Category / Item', 'A category name on its own row, or an item name.'],
  ['Price', 'What the guest pays, in ₹. Just the number.'],
  ['Margin', 'Optional. The ₹ you keep on that item. Only you ever see this.'],
  ['Sizes / Choices', 'Optional. Fill in if the item is sold in more than one way.'],
  ['Add-ons', 'Optional. Extras a guest can add on top.'],
  ['Veg Type', 'Veg or Non-Veg. Leave blank if it does not apply.'],
  ['Description', 'Optional. One short line, shown to guests.'],
  [''],
  ['SIZES / CHOICES'],
  ['', 'Write the name, then its price. Put a comma between each one.'],
  ['', 'Small 89, Medium 119, Large 149'],
  ['', 'Steam 69, Fried 79'],
  ['', '6 Slice 99, 8 Slice 139'],
  ['', 'The number is that option\'s FULL price, not an extra. The guest picks one.'],
  ['', 'Fill this in and you can leave Price empty — the first one becomes the price.'],
  [''],
  ['ADD-ONS'],
  ['', 'Same style, but the number is what it ADDS — like the +20 on a menu board.'],
  ['', 'Cheese Slice 20, Extra Dip 20'],
  ['', 'With Ice-cream 29'],
  [''],
  ['A DIFFERENT MARGIN FOR EACH SIZE?'],
  ['', 'Put it after a slash. Skip it if you do not need it.'],
  ['', 'Small 89/50, Medium 119/60, Large 149/75'],
  ['', 'Small keeps ₹50, Medium keeps ₹60, Large keeps ₹75.'],
  [''],
  ['GOOD TO KNOW'],
  ['', 'Only a name and a price are required. Leave anything else blank.'],
  ['', 'Importing again updates the items you already have — it will not duplicate them.'],
  ['', 'Leave a Sizes or Add-ons cell empty and that item keeps whatever it has now.'],
]

export function downloadMenuTemplate(cafeName: string) {
  const rows: (string | number)[][] = [
    TEMPLATE_HEADER,
    ['BURGERS', '', '', '', '', '', ''],
    ['Classic Veg Burger', 149, 60, '', 'Cheese Slice 20', 'Veg', 'Crispy patty, lettuce and mayo'],
    ['Cheese Burger', 179, 75, '', '', 'Veg', ''],
    ['PIZZA', '', '', '', '', '', ''],
    ['Margherita', 99, '', '6 Slice 99, 8 Slice 139', 'Double Cheese 40', 'Veg', 'Tomato and mozzarella'],
    ['MOMOS', '', '', '', '', '', ''],
    ['Veg Momos', '', '', 'Steam 69, Fried 79', 'Extra Dip 20', 'Veg', ''],
    ['COLD DRINKS', '', '', '', '', '', ''],
    // A café that sells by size needs to see its own case here: dropping the
    // fixed Small/Medium/Large columns otherwise reads as losing the feature.
    ['Cold Coffee', '', '', 'Small 89, Medium 119, Large 149', 'With Ice-cream 29', 'Veg', ''],
    ['Coca Cola', 60, 25, '', '', 'Veg', ''],
  ]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = TEMPLATE_COLS

  const guide = XLSX.utils.aoa_to_sheet(GUIDE_ROWS)
  guide['!cols'] = [{ wch: 18 }, { wch: 82 }]

  const wb = XLSX.utils.book_new()
  // Menu first — readWorkbookRows only ever reads sheet 0, which is what keeps
  // the guide out of the import.
  XLSX.utils.book_append_sheet(wb, ws, 'Menu')
  XLSX.utils.book_append_sheet(wb, guide, 'How to fill this in')
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

/**
 * What one choice actually costs, mirroring menu_item_effective_cost
 * (migration 0106): `greatest(0, coalesce(item.cost, 0) + variant.cost_delta)`.
 *
 * The mirror has to be exact. An owner can give margins on the choices alone
 * and leave the item's own Margin blank — "Small 89/50, Large 149/75" on an
 * item priced only through its choices — which stores cost on the deltas with
 * menu_items.cost still null. Treating a null item cost as "no cost data" would
 * hide those margins from the export while sales and the Profitability report
 * went on using them.
 *
 * Null only when there is genuinely nothing recorded on either side.
 */
export function effectiveOptionCost(itemCost: number | null, costDelta: number): number | null {
  if (itemCost == null && costDelta === 0) return null
  return Math.max(0, (itemCost ?? 0) + costDelta)
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
  // Same column names as the template, so the two sheets read alike.
  const header = ['Category', 'Item', 'Price', 'Margin', 'Sizes / Choices', 'Add-ons', 'Veg Type', 'Description']
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
