import * as XLSX from 'xlsx'
import { safeText } from './xlsx-export'
import { pickMenuSheet } from './menu-import'

// Returns the filename so callers can name it in a toast. The desktop app's
// webview saves silently with no download bar, so without that the café gets
// no sign the export happened at all.
function download(wb: XLSX.WorkBook, filename: string): string {
  XLSX.writeFile(wb, filename)
  return filename
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

const TEMPLATE_HEADER = ['Category / Item', 'Size / Choice', 'Price', 'Margin', 'Add-ons', 'Veg Type', 'Description']
const TEMPLATE_COLS = [{ wch: 26 }, { wch: 15 }, { wch: 8 }, { wch: 8 }, { wch: 24 }, { wch: 10 }, { wch: 38 }]

// Plain language, one idea per line, no jargon. Read top to bottom.
const GUIDE_ROWS: string[][] = [
  ['How to fill in your menu'],
  ['Type everything on the "Menu" tab. This tab is only notes — nothing here is imported.'],
  [''],
  ['THE ONE RULE'],
  ['', 'One row for each thing a guest can order, with its own price and its own margin.'],
  [''],
  ['1.', 'Type a category name on its own row, like BURGERS. Leave the rest of that row empty.'],
  ['2.', 'List that category\'s items underneath it, one per row, with a price.'],
  ['3.', 'Start the next category the same way. Blank rows are fine.'],
  ['4.', 'Replace our example rows with your own before you import.'],
  [''],
  ['WHAT EACH COLUMN IS FOR'],
  ['Category / Item', 'A category name on its own row, or an item name.'],
  ['Size / Choice', 'Only if the item is sold in more than one way. See below.'],
  ['Price', 'What the guest pays, in ₹. Just the number.'],
  ['Margin', 'Optional. The ₹ you keep on that row. Only you ever see this.'],
  ['Add-ons', 'Optional. Extras a guest can add on top.'],
  ['Veg Type', 'Veg or Non-Veg. Leave blank if it does not apply.'],
  ['Description', 'Optional. One short line, shown to guests.'],
  [''],
  ['SOLD IN MORE THAN ONE WAY?'],
  ['', 'Give it one row per option. Repeat the item name, and name the option.'],
  [''],
  ['', 'Cold Coffee     Small     89    50'],
  ['', 'Cold Coffee     Medium    119   60'],
  ['', 'Cold Coffee     Large     149   75'],
  [''],
  ['', 'That is one item with three sizes. The guest picks one.'],
  ['', 'Every row has its own price and its own margin, so they can all differ.'],
  ['', 'Call the options anything you like — Small, 6 Slice, Steam, Fried, Half, Full.'],
  ['', 'Fill in Add-ons, Veg Type and Description on the first row only.'],
  [''],
  ['ADD-ONS'],
  ['', 'Extras the guest can add on top. Write the name, then what it ADDS.'],
  ['', 'Put a comma between each one.'],
  ['', 'Cheese Slice 20, Extra Dip 20'],
  ['', 'With Ice-cream 29'],
  ['', 'Just like the +20 printed on a menu board.'],
  [''],
  ['GOOD TO KNOW'],
  ['', 'Only a name and a price are required. Leave anything else blank.'],
  ['', 'Margin is optional. Skip it and everything still works — you just will not'],
  ['', 'see profit in Reports for that item.'],
  ['', 'Importing again updates the items you already have — it will not duplicate them.'],
  ['', 'Leave an Add-ons cell empty and that item keeps whatever it has now.'],
]

export function downloadMenuTemplate(cafeName: string) {
  const rows: (string | number)[][] = [
    TEMPLATE_HEADER,
    ['BURGERS', '', '', '', '', '', ''],
    ['Classic Veg Burger', '', 149, 60, 'Cheese Slice 20', 'Veg', 'Crispy patty, lettuce and mayo'],
    ['Cheese Burger', '', 179, 75, '', 'Veg', ''],
    ['PIZZA', '', '', '', '', '', ''],
    // One row per thing a guest can actually order, each with its own price and
    // its own margin. Repeat the item name on each of its rows.
    ['Margherita', '6 Slice', 99, 40, 'Double Cheese 40', 'Veg', 'Tomato and mozzarella'],
    ['Margherita', '8 Slice', 139, 80, '', '', ''],
    ['MOMOS', '', '', '', '', '', ''],
    ['Veg Momos', 'Steam', 69, 25, 'Extra Dip 20', 'Veg', ''],
    ['Veg Momos', 'Fried', 79, 35, '', '', ''],
    ['COLD DRINKS', '', '', '', '', '', ''],
    // A café that sells by size needs to see its own case here.
    ['Cold Coffee', 'Small', 89, 50, 'With Ice-cream 29', 'Veg', ''],
    ['Cold Coffee', 'Medium', 119, 60, '', '', ''],
    ['Cold Coffee', 'Large', 149, 75, '', '', ''],
    ['Coca Cola', '', 60, 25, '', 'Veg', ''],
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
  return download(wb, `${cafeName || 'cafe'}-menu-template.xlsx`.replace(/\s+/g, '-'))
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
      // A slash inside a name would re-split on import too, since a menu board
      // writes free choices as "Onion / Corn".
      const name = o.name.replace(/[,;\n/]/g, ' ').replace(/\s+/g, ' ').trim()
      // A free extra exports as just its name, which is how it was typed.
      if (o.price === 0 && margin == null) return name
      return margin != null ? `${name} ${o.price}/${margin}` : `${name} ${o.price}`
    })
    .join(', ')
}

// Flat/repeated-category shape — safe to sort, filter, and bulk-edit in Excel
// without breaking category grouping, then re-import without duplicating. That
// property is why choices and add-ons are cells rather than extra rows: rows
// would detach from their item the first time anyone sorted by price.
export function downloadMenuExport(cafeName: string, rows: ExportRow[]) {
  // Same columns as the template, so the two sheets read alike — and one row
  // per thing a guest can order, each showing its own price and margin.
  const header = ['Category', 'Item', 'Size / Choice', 'Price', 'Margin', 'Add-ons', 'Veg Type', 'Description']
  const margin = (price: number, cost: number | null) => (cost != null ? price - cost : '')
  const body = rows.flatMap((r) => {
    const shared = [
      safeText(optionCell(r.addons)),
      r.isVeg === true ? 'Veg' : r.isVeg === false ? 'Non-Veg' : '',
      safeText(r.description ?? ''),
    ]
    if (!r.choices?.length) {
      return [[safeText(r.category), safeText(r.name), '', r.price, margin(r.price, r.cost), ...shared]]
    }
    // Add-ons, veg and description belong to the item, so they sit on its first
    // row only — repeating them would imply they differ per size, and the
    // importer reads them from the first row that supplies them anyway.
    return r.choices.map((c, i) => [
      safeText(r.category),
      safeText(r.name),
      safeText(c.name),
      c.price,
      margin(c.price, c.cost),
      ...(i === 0 ? shared : ['', '', '']),
    ])
  })
  const ws = XLSX.utils.aoa_to_sheet([header, ...body])
  ws['!cols'] = [{ wch: 20 }, { wch: 26 }, { wch: 15 }, { wch: 8 }, { wch: 8 }, { wch: 26 }, { wch: 10 }, { wch: 34 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Menu')
  return download(wb, `${cafeName || 'cafe'}-menu-export.xlsx`.replace(/\s+/g, '-'))
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
  return download(wb, `${cafeName || 'cafe'}-combos.xlsx`.replace(/\s+/g, '-'))
}

// Reads an uploaded .csv or .xlsx File into a plain array-of-arrays, the input
// shape parseMenuFile expects — one place that understands the file format,
// so the parser itself stays format-agnostic.
//
// Every sheet is read, not just the first. An export from another system puts
// the menu wherever it likes, and pickMenuSheet chooses the one that actually
// looks like a menu — which also keeps our own template's "How to fill this in"
// tab out of the import no matter what order the tabs end up in.
export async function readWorkbookRows(file: File): Promise<unknown[][]> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const sheets = wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }) as unknown[][],
  }))
  return pickMenuSheet(sheets)?.rows ?? []
}
