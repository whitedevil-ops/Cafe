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

// Reads an uploaded .csv or .xlsx File into a plain array-of-arrays, the input
// shape parseMenuFile expects — one place that understands the file format,
// so the parser itself stays format-agnostic.
export async function readWorkbookRows(file: File): Promise<unknown[][]> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][]
}
