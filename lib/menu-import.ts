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
  /** The choices a guest picks exactly one of, as ABSOLUTE prices. Names are
      free-form — "6 Slice", "Steam", "Small" — because a café's menu board
      decides them, not us. Empty when the row supplied none.
      cost is likewise absolute (not a delta) and null when unsupplied. */
  variants: { name: string; price: number; cost: number | null }[]
  /** Optional extras, as the amount each ADDS to the price — "Cheese Slice 20".
      Empty when the row supplied none. */
  addons: { name: string; price: number }[]
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

/**
 * Undoes the leading apostrophe the export adds (safeText, xlsx-export.ts) to
 * any text starting with =, +, -, @ so Excel can't read it as a formula.
 * Without this an item or option called "+Cheese" comes back as "'+Cheese" —
 * a different name, so a re-import creates a duplicate instead of updating.
 */
function unquote(s: string): string {
  return s.startsWith("'") ? s.slice(1) : s
}

/** Trimmed text with the export's formula guard undone. */
function text(s: unknown): string {
  return unquote(normalize(s))
}

function findColumn(header: string[], predicate: (h: string) => boolean): number {
  return header.findIndex((h) => predicate(h.toLowerCase()))
}

/** Reads one cell, tolerating rows Excel truncated to the last filled column. */
function cellAt(raw: unknown[], idx: number): unknown {
  return idx >= 0 && idx < raw.length ? raw[idx] : ''
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

/** One entry from a Choices or Add-ons cell. */
export type ParsedOption = { name: string; price: number; margin: number | null }

// A café's options are whatever its menu board says — "6 Slice", "Steam",
// "With Ice-cream", "Injector". They can't be fixed columns, so both lists live
// in one cell each, one entry per option:
//
//   Steam 69, Fried 79          6 Slice 99, 8 Slice 139        Cheese Slice 20
//
// The LAST number in an entry is its price, so a name may itself contain
// digits ("6 Slice 99" → "6 Slice" at ₹99). An optional "/margin" suffix
// carries costing ("Steam 69/20"). Menu boards write prices as "+20" or "@30",
// so both are accepted and mean the same as a bare number.
//
// Entries split on comma, semicolon, or newline — a newline because Alt+Enter
// inside a cell is how an owner naturally lists several, and Excel keeps it.
export function parseOptionList(raw: unknown, row: number, label: string, issues: ImportIssue[]): ParsedOption[] {
  const cell = text(raw)
  if (!cell) return []
  const out: ParsedOption[] = []
  for (const entry of cell.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean)) {
    const m = entry.match(/^(.+?)[\s:–—-]*[+@]?\s*₹?\s*(\d+(?:\.\d+)?)(?:\s*\/\s*₹?\s*(\d+(?:\.\d+)?))?$/)
    if (!m) {
      issues.push({ row, message: `"${label}" — couldn't read "${entry}". Write each one as Name Price, e.g. "Steam 69".` })
      continue
    }
    const name = m[1].trim()
    const price = Math.round(Number(m[2]))
    const margin = m[3] === undefined ? null : Math.round(Number(m[3]))
    if (!name) {
      issues.push({ row, message: `"${label}" — "${entry}" has a price but no name, skipped.` })
      continue
    }
    if (!Number.isFinite(price) || price < 0) {
      issues.push({ row, message: `"${label}" — "${entry}" has an invalid price, skipped.` })
      continue
    }
    if (margin !== null && (!Number.isFinite(margin) || margin < 0 || margin > price)) {
      issues.push({ row, message: `"${label}" — margin in "${entry}" is not a valid amount below its price, ignored.` })
      out.push({ name, price, margin: null })
      continue
    }
    out.push({ name, price, margin })
  }
  // Same rule the rest of the importer follows for duplicates: last one wins.
  const byName = new Map<string, ParsedOption>()
  for (const o of out) {
    if (byName.has(o.name.toLowerCase())) {
      issues.push({ row, message: `"${label}" — "${o.name}" is listed twice, using the last one.` })
    }
    byName.set(o.name.toLowerCase(), o)
  }
  return [...byName.values()]
}

export function parseMenuFile(rows: unknown[][]): ParseResult {
  const issues: ImportIssue[] = []
  const [headerRow, ...dataRows] = rows
  const header = (headerRow ?? []).map((h) => normalize(h))

  const catCol = findColumn(header, (h) => h.includes('category'))
  const itemCol = findColumn(header, (h) => h.includes('item') || h.includes('name'))
  const sizeWords = ['small', 'medium', 'med', 'large']
  const isSizeSpecific = (h: string) => sizeWords.some((w) => h.includes(w))
  // "Margin" and "Profit" mean the same thing here — the sheets we hand out
  // say Margin (it's the question an owner can answer without doing sums),
  // but older exports said Profit and must keep importing.
  const isMarginWord = (h: string) => h.includes('profit') || h.includes('margin')
  // "Cost Price" contains "price", so cost must be matched first and price must
  // exclude it — otherwise the cost column would be read as the selling price.
  // Excludes size-specific columns ("Small Cost") so they aren't double-matched
  // as the item's own base cost.
  const costCol = findColumn(header, (h) => h.includes('cost') && !isSizeSpecific(h))
  // Margin is an alternative way to supply the same number: an owner who
  // thinks "I make ₹20 on this burger" rather than "this costs me ₹80" can
  // fill in Margin instead of Cost Price — cost is derived (price − margin)
  // and stored exactly like a directly-supplied cost. If a file somehow has
  // both, the explicit Cost Price column wins.
  const profitCol = findColumn(header, (h) => isMarginWord(h) && !isSizeSpecific(h))
  const priceCol = findColumn(header, (h) => h.includes('price') && !h.includes('cost') && !isMarginWord(h) && !isSizeSpecific(h))
  const vegCol = findColumn(header, (h) => h.includes('veg'))
  const descCol = findColumn(header, (h) => h.includes('desc'))
  // The generic option columns. "Choices" replaced the fixed
  // Small/Medium/Large columns because a café's sizes are its own —
  // "6 Slice", "Steam"/"Fried", "3 Slices" — and no fixed set covers them.
  // Matched loosely so "Choices (pick one)", "Sizes" and "Options" all work.
  const choicesCol = findColumn(header, (h) => h.includes('choice') || h.includes('option') || (h.includes('size') && !isMarginWord(h)))
  const addonsCol = findColumn(header, (h) => h.includes('add-on') || h.includes('addon') || h.includes('add on') || h.includes('extra'))
  // Legacy size columns — absolute prices (and optionally an absolute
  // Cost/Profit) per size, converted to base + variant deltas at write time
  // (matches how the per-item editor already stores variants). Leave a size
  // blank for an item with only one.
  const sizeCols: { name: string; col: number; costCol: number; profitCol: number }[] = (
    [
      ['Small', 'small'],
      ['Medium', 'med'],
      ['Large', 'large'],
    ] as const
  )
    .map(([name, word]) => ({
      name,
      // The size's own price column — must exclude its Cost/Margin sibling,
      // or "Small Margin" would be read as the Small price.
      col: findColumn(header, (h) => h.includes(word) && !h.includes('cost') && !isMarginWord(h)),
      costCol: findColumn(header, (h) => h.includes(word) && h.includes('cost')),
      profitCol: findColumn(header, (h) => h.includes(word) && isMarginWord(h)),
    }))
    .filter((s) => s.col !== -1)
  const hasSizeCols = sizeCols.length > 0

  // Resolves a size's absolute cost from its own Cost or Profit cell, given
  // that size's own (already-resolved) price — the exact same cost-or-profit
  // choice the base item gets, just scoped to one size's numbers instead of
  // the item's.
  function resolveSizeCost(raw: unknown[], sizeCol: { costCol: number; profitCol: number }, sizePrice: number, row: number, label: string): number | null {
    if (sizeCol.costCol !== -1) {
      const c = sizeCol.costCol < raw.length ? raw[sizeCol.costCol] : ''
      if (normalize(c) === '') return null
      const v = parsePrice(c)
      if (v === null) { issues.push({ row, message: `"${label}" — cost is not a valid amount, ignored.` }); return null }
      return v
    }
    if (sizeCol.profitCol !== -1) {
      const p = sizeCol.profitCol < raw.length ? raw[sizeCol.profitCol] : ''
      if (normalize(p) === '') return null
      const v = parsePrice(p)
      if (v === null) { issues.push({ row, message: `"${label}" — profit is not a valid amount, ignored.` }); return null }
      if (v > sizePrice) { issues.push({ row, message: `"${label}" — profit is more than its price, ignored.` }); return null }
      return sizePrice - v
    }
    return null
  }

  // Resolves a row's price and its choices together, since whether choices are
  // given changes what "the price" even means:
  //  - Price filled: that's the base; every choice becomes a variant
  //    (delta = choice price − base), even one that happens to match the base.
  //  - Price blank but choices given: the FIRST choice becomes the base
  //    instead, so the item still gets a valid price — it isn't also re-added
  //    as a redundant variant of itself.
  //  - Neither: unchanged from before options existed.
  //
  // The Choices column wins over the legacy Small/Medium/Large columns when a
  // file somehow has both, since it's the one the current template hands out.
  function resolvePriceAndSizes(
    raw: unknown[],
    priceRaw: unknown,
    row: number,
    label: string,
  ): { price: number | null; variants: { name: string; price: number; cost: number | null }[] } {
    if (choicesCol !== -1) {
      const opts = parseOptionList(cellAt(raw, choicesCol), row, label, issues)
      if (opts.length > 0) {
        const variants = opts.map((o) => ({
          name: o.name,
          price: o.price,
          cost: o.margin === null ? null : o.price - o.margin,
        }))
        const explicit = parsePrice(priceRaw)
        return { price: explicit ?? variants[0].price, variants }
      }
      // Empty Choices cell — fall through to the legacy size columns, so a
      // sheet mixing the two still imports whatever it has.
    }
    if (!hasSizeCols) return { price: parsePrice(priceRaw), variants: [] }

    const filled = sizeCols
      .map((s) => ({ s, raw: s.col < raw.length ? raw[s.col] : '' }))
      .filter((x) => normalize(x.raw) !== '')
    if (filled.length === 0) return { price: parsePrice(priceRaw), variants: [] }

    const parsed = filled.map((x) => ({ s: x.s, price: parsePrice(x.raw) }))
    for (const x of parsed) {
      if (x.price === null) issues.push({ row, message: `"${label}" — ${x.s.name} price is not a valid amount, ignored.` })
    }
    const valid = parsed.filter((x): x is { s: typeof sizeCols[number]; price: number } => x.price !== null)
    if (valid.length === 0) return { price: parsePrice(priceRaw), variants: [] }

    const withCost = valid.map((x) => ({
      name: x.s.name,
      price: x.price,
      cost: resolveSizeCost(raw, x.s, x.price, row, `${label} — ${x.s.name}`),
    }))

    const explicitPrice = parsePrice(priceRaw)
    if (explicitPrice !== null) {
      return { price: explicitPrice, variants: withCost }
    }
    // No base price given — use the first filled size as the base price.
    // It STILL becomes its own variant (delta 0) rather than being
    // dropped: the POS requires picking one of the listed variants
    // whenever an item has any, with no "no variant" option, so omitting
    // it here made that size literally unselectable at the till.
    return { price: withCost[0].price, variants: withCost }
  }

  // Parses the optional cost cell for a row; invalid (negative/non-numeric)
  // values are flagged and treated as "no cost" rather than failing the row.
  function parseCost(raw: unknown[], row: number, price: number): number | null {
    if (costCol !== -1) {
      const c = costCol < raw.length ? raw[costCol] : ''
      if (normalize(c) === '') return null
      const v = parsePrice(c)
      if (v === null) {
        issues.push({ row, message: `Cost "${c}" is not a valid amount — left unset.` })
        return null
      }
      return v
    }
    if (profitCol !== -1) {
      const p = profitCol < raw.length ? raw[profitCol] : ''
      if (normalize(p) === '') return null
      const v = parsePrice(p)
      if (v === null) {
        issues.push({ row, message: `Profit "${p}" is not a valid amount — left unset.` })
        return null
      }
      if (v > price) {
        issues.push({ row, message: `Profit "${v}" is more than the price — left unset.` })
        return null
      }
      return price - v
    }
    return null
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
    const cell = (idx: number) => cellAt(raw, idx)
    const allBlank = raw.every((c) => normalize(c) === '')
    if (allBlank) return // blank rows are silently ignored, as specified

    // Add-ons carry no cost of their own — menu_item_addons stores a name and a
    // price and nothing else — so a "/margin" suffix here has nowhere to go.
    const readAddons = (label: string) => {
      const opts = parseOptionList(cell(addonsCol), rowNum, label, issues)
      for (const o of opts) {
        if (o.margin !== null) {
          issues.push({ row: rowNum, message: `"${label}" — margin on the add-on "${o.name}" isn't tracked, ignored.` })
        }
      }
      return opts.map((o) => ({ name: o.name, price: o.price }))
    }

    if (isFlat) {
      const name = text(cell(itemCol))
      if (!name) return // no item name at all — nothing to import from this row
      const priceRaw = cell(priceCol)
      const { price, variants } = resolvePriceAndSizes(raw, priceRaw, rowNum, name)
      if (price === null) {
        issues.push({ row: rowNum, message: `"${name}" — missing or invalid price, skipped.` })
        return
      }
      const cat = text(cell(catCol)) || currentCategory || 'Uncategorised'
      if (!text(cell(catCol)) && currentCategory === null) {
        issues.push({ row: rowNum, message: `"${name}" has no category and none carried over — filed under Uncategorised.` })
      }
      currentCategory = cat
      addTo(cat, {
        row: rowNum,
        category: cat,
        name,
        price,
        cost: parseCost(raw, rowNum, price),
        isVeg: parseVeg(cell(vegCol), rowNum, issues),
        description: descCol !== -1 ? text(cell(descCol)) || null : null,
        variants,
        addons: readAddons(name),
      })
    } else {
      const mergedText = text(cell(mergedCol))
      const priceRaw = cell(priceCol)
      const priceText = normalize(priceRaw)
      // An item priced only through its choices ("Veg Momos — Steam 69, Fried
      // 79") has a blank Price cell, so the Choices cell has to count as
      // "priced" here too, or it would be mistaken for a category heading.
      const anySizeFilled =
        (hasSizeCols && sizeCols.some((s) => normalize(cellAt(raw, s.col)) !== '')) ||
        normalize(cell(choicesCol)) !== ''
      if (!mergedText) return

      if (!priceText && !anySizeFilled) {
        // No price and no choices → it's a category heading, per spec.
        currentCategory = mergedText
        if (!groups.has(mergedText)) {
          groups.set(mergedText, [])
          order.push(mergedText)
        }
        return
      }

      const { price, variants } = resolvePriceAndSizes(raw, priceRaw, rowNum, mergedText)
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
        cost: parseCost(raw, rowNum, price),
        isVeg: parseVeg(cell(vegCol), rowNum, issues),
        description: descCol !== -1 ? text(cell(descCol)) || null : null,
        variants,
        addons: readAddons(mergedText),
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
