// Bulk menu import parsing — pure functions, no React/Supabase dependency, so
// the classification logic is easy to reason about and test in isolation.
//
// Two supported file shapes, auto-detected from the header row:
//   FORMAT A ("heading style") — one "Category / Item" column. A row with a
//     blank price is a category heading; everything below it belongs to that
//     category until the next heading. This is the shape of the downloadable
//     template — fastest for a non-technical owner to type by hand.
//   FORMAT B ("flat") — separate Category and Item columns, category repeated
//     on every row. This is the shape Export Menu produces, because a flat
//     table is safe to sort/filter in Excel without breaking category
//     grouping — a heading-style sheet is fragile under that kind of editing.

export type ParsedItem = {
  row: number
  category: string
  name: string
  price: number
  /** Optional estimated cost (₹). Null when the file has no cost column or the
      cell is blank. Never required — existing imports keep working. */
  cost: number | null
  isVeg: boolean | null
  description: string | null
}
export type ImportIssue = { row: number; message: string }

export type ExistingItem = { categoryName: string; itemName: string }

export type ParseResult = {
  format: 'heading' | 'flat'
  byCategory: { name: string; items: ParsedItem[] }[]
  issues: ImportIssue[]
  totalItems: number
  updateCount: number
  insertCount: number
}

function normalize(s: unknown): string {
  return String(s ?? '').trim()
}

function findColumn(header: string[], predicate: (h: string) => boolean): number {
  return header.findIndex((h) => predicate(h.toLowerCase()))
}

function parsePrice(raw: unknown): number | null {
  const s = normalize(raw).replace(/[₹,\s]/g, '')
  if (!s) return null
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n)
}

function parseVeg(raw: unknown, row: number, issues: ImportIssue[]): boolean | null {
  const s = normalize(raw).toLowerCase()
  if (!s) return null
  if (['veg', 'vegetarian', 'v', 'yes'].includes(s)) return true
  if (['non-veg', 'nonveg', 'non vegetarian', 'nv', 'no'].includes(s)) return false
  issues.push({ row, message: `Veg type "${raw}" not recognized — left unspecified. Use "Veg" or "Non-Veg".` })
  return null
}

export function parseMenuFile(rows: unknown[][]): ParseResult {
  const issues: ImportIssue[] = []
  const [headerRow, ...dataRows] = rows
  const header = (headerRow ?? []).map((h) => normalize(h))
  const headerLower = header.map((h) => h.toLowerCase())

  const catCol = findColumn(header, (h) => h.includes('category'))
  const itemCol = findColumn(header, (h) => h.includes('item') || h.includes('name'))
  // "Cost Price" contains "price", so cost must be matched first and price must
  // exclude it — otherwise the cost column would be read as the selling price.
  const costCol = findColumn(header, (h) => h.includes('cost'))
  const priceCol = findColumn(header, (h) => h.includes('price') && !h.includes('cost'))
  const vegCol = findColumn(header, (h) => h.includes('veg'))
  const descCol = findColumn(header, (h) => h.includes('desc'))

  // Parses the optional cost cell for a row; invalid (negative/non-numeric)
  // values are flagged and treated as "no cost" rather than failing the row.
  function parseCost(raw: unknown[], row: number): number | null {
    if (costCol === -1) return null
    const c = costCol < raw.length ? raw[costCol] : ''
    if (normalize(c) === '') return null
    const v = parsePrice(c)
    if (v === null) {
      issues.push({ row, message: `Cost "${c}" is not a valid amount — left unset.` })
      return null
    }
    return v
  }

  // Flat format needs a category column that is DISTINCT from the item column.
  const isFlat = catCol !== -1 && itemCol !== -1 && catCol !== itemCol
  const mergedCol = isFlat ? -1 : (itemCol !== -1 ? itemCol : catCol !== -1 ? catCol : 0)

  const groups = new Map<string, ParsedItem[]>()
  const order: string[] = []
  let currentCategory: string | null = null

  function addTo(category: string, item: ParsedItem) {
    const key = category
    if (!groups.has(key)) {
      groups.set(key, [])
      order.push(key)
    }
    groups.get(key)!.push(item)
  }

  dataRows.forEach((raw, i) => {
    const rowNum = i + 2 // account for header row + 1-indexing, matches what a user sees in Excel
    const cell = (idx: number) => (idx >= 0 && idx < raw.length ? raw[idx] : '')
    const allBlank = raw.every((c) => normalize(c) === '')
    if (allBlank) return // blank rows are silently ignored, as specified

    if (isFlat) {
      const name = normalize(cell(itemCol))
      if (!name) return // no item name at all — nothing to import from this row
      const priceRaw = cell(priceCol)
      const price = parsePrice(priceRaw)
      if (price === null) {
        issues.push({ row: rowNum, message: `"${name}" — missing or invalid price, skipped.` })
        return
      }
      const cat = normalize(cell(catCol)) || currentCategory || 'Uncategorised'
      if (!normalize(cell(catCol)) && currentCategory === null) {
        issues.push({ row: rowNum, message: `"${name}" has no category and none carried over — filed under Uncategorised.` })
      }
      currentCategory = cat
      addTo(cat, {
        row: rowNum,
        category: cat,
        name,
        price,
        cost: parseCost(raw, rowNum),
        isVeg: parseVeg(cell(vegCol), rowNum, issues),
        description: descCol !== -1 ? normalize(cell(descCol)) || null : null,
      })
    } else {
      const mergedText = normalize(cell(mergedCol))
      const priceRaw = cell(priceCol)
      const priceText = normalize(priceRaw)
      if (!mergedText) return

      if (!priceText) {
        // No price on this row → it's a category heading, per spec.
        currentCategory = mergedText
        if (!groups.has(mergedText)) {
          groups.set(mergedText, [])
          order.push(mergedText)
        }
        return
      }

      const price = parsePrice(priceRaw)
      if (price === null) {
        issues.push({ row: rowNum, message: `"${mergedText}" — invalid price "${priceRaw}", skipped.` })
        return
      }
      if (currentCategory === null) {
        issues.push({ row: rowNum, message: `"${mergedText}" appears before any category heading — filed under Uncategorised.` })
      }
      const cat = currentCategory ?? 'Uncategorised'
      addTo(cat, {
        row: rowNum,
        category: cat,
        name: mergedText,
        price,
        cost: parseCost(raw, rowNum),
        isVeg: parseVeg(cell(vegCol), rowNum, issues),
        description: descCol !== -1 ? normalize(cell(descCol)) || null : null,
      })
    }
  })

  // Within-file duplicate detection (same category + name twice) — keep the
  // last occurrence, since that's what a spreadsheet edit usually means.
  for (const [cat, items] of groups) {
    const seen = new Map<string, number>()
    items.forEach((it, idx) => {
      const key = it.name.toLowerCase()
      if (seen.has(key)) {
        const prevIdx = seen.get(key)!
        issues.push({
          row: it.row,
          message: `"${it.name}" appears more than once in "${cat}" — using row ${it.row}, ignoring row ${items[prevIdx].row}.`,
        })
        items[prevIdx] = it // overwrite the earlier one in place
        items.splice(idx, 1)
      } else {
        seen.set(key, idx)
      }
    })
  }

  const byCategory = order
    .filter((name) => (groups.get(name) ?? []).length > 0)
    .map((name) => ({ name, items: groups.get(name)! }))

  const totalItems = byCategory.reduce((s, c) => s + c.items.length, 0)

  return { format: isFlat ? 'flat' : 'heading', byCategory, issues, totalItems, updateCount: 0, insertCount: 0 }
}

// Cross-references parsed items against the café's current menu so the preview
// can say "12 new, 3 will be updated" instead of guessing — and so re-importing
// an exported+edited file never creates duplicate items.
export function markUpdatesVsInserts(result: ParseResult, existing: ExistingItem[]): ParseResult {
  const existingKeys = new Set(existing.map((e) => `${e.categoryName.toLowerCase()}::${e.itemName.toLowerCase()}`))
  let updateCount = 0
  let insertCount = 0
  for (const cat of result.byCategory) {
    for (const item of cat.items) {
      const key = `${cat.name.toLowerCase()}::${item.name.toLowerCase()}`
      if (existingKeys.has(key)) updateCount++
      else insertCount++
    }
  }
  return { ...result, updateCount, insertCount }
}
