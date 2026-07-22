import * as XLSX from 'xlsx'

function download(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename)
}

// The blank starting template — heading style, exactly the shape a
// non-technical owner can fill in by typing a category name, then item rows
// underneath, repeating. Pre-filled with the worked example so it's obvious
// how it works on first open, not just a bare header row.
export function downloadMenuTemplate(cafeName: string) {
  const rows: (string | number)[][] = [
    ['Category / Item', 'Price', 'Veg Type', 'Description'],
    ['BURGERS', '', '', ''],
    ['Classic Veg Burger', 149, 'Veg', 'Classic vegetable burger'],
    ['Cheese Burger', 179, 'Veg', 'Burger with cheese'],
    ['SOFT DRINKS', '', '', ''],
    ['Coca Cola', 60, 'Veg', ''],
    ['Sprite', 60, 'Veg', ''],
  ]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 26 }, { wch: 10 }, { wch: 12 }, { wch: 34 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Menu template')
  download(wb, `${cafeName || 'cafe'}-menu-template.xlsx`.replace(/\s+/g, '-'))
}

export type ExportRow = {
  category: string
  name: string
  price: number
  isVeg: boolean | null
  description: string | null
}

// Flat/repeated-category shape — safe to sort, filter, and bulk-edit in Excel
// without breaking category grouping, then re-import without duplicating.
export function downloadMenuExport(cafeName: string, rows: ExportRow[]) {
  const header = ['Category', 'Item', 'Price', 'Veg Type', 'Description']
  const body = rows.map((r) => [
    r.category,
    r.name,
    r.price,
    r.isVeg === true ? 'Veg' : r.isVeg === false ? 'Non-Veg' : '',
    r.description ?? '',
  ])
  const ws = XLSX.utils.aoa_to_sheet([header, ...body])
  ws['!cols'] = [{ wch: 20 }, { wch: 26 }, { wch: 10 }, { wch: 12 }, { wch: 34 }]
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
