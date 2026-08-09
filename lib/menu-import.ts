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
  /** Rows the file itself marks as inactive, left out of the import. */
  skippedInactive: number
  /** "Add On Burger" style categories folded into the add-ons of a real category. */
  foldedAddonGroups: { name: string; target: string; addons: number; items: number }[]
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
export function parseOptionList(
  raw: unknown,
  row: number,
  label: string,
  issues: ImportIssue[],
  /** Add-ons may be free — a pizza's "Onion / Corn / Capsicum" costs nothing. */
  { allowFree = false }: { allowFree?: boolean } = {},
): ParsedOption[] {
  const cell = text(raw)
  if (!cell) return []
  // A menu board separates free choices with slashes — "Onion / Corn / Tomato"
  // — so a slash is another separator, EXCEPT between two digits where it's the
  // margin suffix ("Small 89/50"). Done without lookbehind so it still works on
  // older Safari.
  const flattened = cell.replace(/(\d?)\s*\/\s*(\d?)/g, (m, before, after) => (before && after ? m : `${before},${after}`))
  const out: ParsedOption[] = []
  for (const entry of flattened.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean)) {
    const m = entry.match(/^(.+?)[\s:–—-]*[+@]?\s*₹?\s*(\d+(?:\.\d+)?)(?:\s*\/\s*₹?\s*(\d+(?:\.\d+)?))?$/)
    if (!m) {
      // A name with no price is a free extra — the toppings a pizza lets you
      // choose at no charge. Only add-ons can be free; a size with no price
      // would just be a mistake, so there it still reads as an error.
      if (allowFree) {
        out.push({ name: entry, price: 0, margin: null })
        continue
      }
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

// ── Finding the actual table inside someone else's file ─────────────────────
// An export from another system rarely starts with the header on row 1 of the
// first sheet: there's a report title, the restaurant's name, a blank line, a
// "generated on" stamp. And a workbook often holds the menu on a later tab.
// Both are decided by scoring rather than by position, so an owner can upload
// what their old system gave them without editing it first.

const CONCEPTS: ((h: string) => boolean)[] = [
  (h) => /(^|\W)(item|name|title|product|dish)(\W|$)/.test(h),
  (h) => /price|amount|\brate\b|mrp/.test(h),
  (h) => /category|section/.test(h),
  (h) => /desc/.test(h),
  (h) => /veg|food type/.test(h),
]

/** How much a row reads like a header — how many distinct menu concepts it names. */
function headerScore(row: unknown[]): number {
  const cells = row.map((c) => normalize(c).toLowerCase()).filter(Boolean)
  if (cells.length < 2) return 0
  const hit = CONCEPTS.map((test) => cells.some(test))
  // A name and a price are the minimum that makes a table a menu; without both
  // this is a title or a stray line, not the header.
  if (!hit[0] || !hit[1]) return 0
  return hit.filter(Boolean).length
}

/**
 * Index of the header row, skipping any preamble. Falls back to 0 so a file we
 * can't read confidently behaves exactly as before rather than silently
 * shifting rows.
 */
export function findHeaderRow(rows: unknown[][], maxScan = 15): number {
  let best = 0
  let bestScore = 0
  for (let i = 0; i < Math.min(rows.length, maxScan); i++) {
    const score = headerScore(rows[i] ?? [])
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  }
  return bestScore > 0 ? best : 0
}

/**
 * The sheet in a workbook that actually holds the menu. Scores each by how
 * header-like its best row is, then by how much data follows — so a cover sheet
 * or our own template's "How to fill this in" tab never wins.
 */
export function pickMenuSheet<T extends { rows: unknown[][] }>(sheets: T[]): T | null {
  let best: T | null = null
  let bestRank = -1
  for (const sheet of sheets) {
    const at = findHeaderRow(sheet.rows)
    const score = headerScore(sheet.rows[at] ?? [])
    const body = Math.max(0, sheet.rows.length - at - 1)
    if (score === 0 || body === 0) continue
    const rank = score * 1000 + Math.min(body, 999)
    if (rank > bestRank) {
      bestRank = rank
      best = sheet
    }
  }
  return best ?? sheets[0] ?? null
}

export function parseMenuFile(input: unknown[][]): ParseResult {
  const issues: ImportIssue[] = []
  // Drop anything above the header — a report title, a blank line, a date stamp.
  const rows = input.slice(findHeaderRow(input))
  const [headerRow, ...dataRows] = rows
  const header = (headerRow ?? []).map((h) => normalize(h))

  // Exact header names win before loose matching, because a POS export is full
  // of columns that merely CONTAIN these words. A Petpooja export names the
  // item "Title" and also carries "Base Item Price", "Item Type", "Item Sort"
  // and "Is Furnished item" — loose matching picked "Base Item Price" as the
  // name column, so every item imported called "129" or "99". Likewise "Sub
  // Category" must never beat "Category".
  const exactly = (...names: string[]) => (h: string) => names.includes(h.trim())
  const firstOf = (strict: (h: string) => boolean, loose: (h: string) => boolean) => {
    const hit = findColumn(header, strict)
    return hit !== -1 ? hit : findColumn(header, loose)
  }
  const catCol = firstOf(
    exactly('category', 'category name', 'menu category', 'section', 'course'),
    (h) => h.includes('category'),
  )
  const itemCol = firstOf(
    exactly('item', 'item name', 'name', 'title', 'item title', 'product', 'product name', 'dish', 'dish name'),
    (h) =>
      (h.includes('item') || h.includes('name')) &&
      !h.includes('price') && !h.includes('cost') && !h.includes('type') &&
      !h.includes('sort') && !h.includes('code') && !h.includes('category'),
  )
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
  // A "Discounted Price" column is an offer price, not what the item sells for,
  // so it must never win over the real one. Other systems also call the price
  // MRP or Rate, hence the exact-name pass.
  const isRealPrice = (h: string) =>
    !h.includes('cost') && !isMarginWord(h) && !isSizeSpecific(h) &&
    !h.includes('discount') && !h.includes('offer') && !h.includes('old ')
  const priceCol = firstOf(
    exactly('price', 'base price', 'base item price', 'item price', 'selling price', 'mrp', 'rate', 'default price'),
    (h) => (h.includes('price') || h === 'mrp' || h.includes('rate')) && isRealPrice(h),
  )
  // POS exports label this "Food Type" and fill it with Veg / Non-veg.
  const vegCol = findColumn(header, (h) => h.includes('veg') || h.trim() === 'food type')
  // A POS keeps discontinued dishes on file with an inactive flag — the Zorko
  // export carries 245 of them among 410 rows. Importing those would launch a
  // café with a menu two-thirds full of things it no longer sells. Matched on
  // exact header names so "Platform Status" and the like can't be mistaken for
  // it, and only an explicitly false value skips a row; blank means keep.
  const activeCol = findColumn(
    header,
    exactly('isactive', 'is active', 'active', 'enabled', 'is enabled', 'is available', 'available', 'availability'),
  )
  const FALSEY = ['0', 'false', 'no', 'n', 'inactive', 'disabled', 'off']
  const isInactive = (raw: unknown) => activeCol !== -1 && FALSEY.includes(normalize(raw).toLowerCase())
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
    isOptionRow: boolean,
  ): { price: number | null; variants: { name: string; price: number; cost: number | null }[] } {
    // The row IS one option, so its Size cell is a name and its Price is that
    // option's own price. Nothing to expand.
    if (isOptionRow) return { price: parsePrice(priceRaw), variants: [] }
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

  // Does the Size / Choice column hold one option name per row (current
  // format), or the older all-in-one-cell list with prices baked in?
  //
  // Decided once for the whole column rather than per cell, because a single
  // cell is genuinely ambiguous — "6 Slice 99" could be a legacy entry or an
  // option a café happens to have named that. Looking at every cell resolves
  // it: a list format gives itself away with separators, or by every cell
  // ending in a price.
  const choiceCells = choicesCol === -1 ? [] : dataRows.map((r) => text(cellAt(r, choicesCol))).filter(Boolean)
  const choicesAreLegacyList =
    choiceCells.length > 0 &&
    (choiceCells.some((c) => /[,;\n]/.test(c)) || choiceCells.every((c) => /\d\s*$/.test(c)))

  /** The option this row describes — "6 Slice", "Steam", "Large". */
  function rowOptionName(raw: unknown[]): string | null {
    if (choicesCol === -1 || choicesAreLegacyList) return null
    return text(cellAt(raw, choicesCol)) || null
  }

  // One spreadsheet row. Several rows sharing a category + item name are one
  // menu item with several options — that grouping happens after the sweep, so
  // it survives an owner sorting or filtering the sheet in Excel.
  type RowRec = {
    row: number
    category: string
    name: string
    /** Non-null when this row is one option of the item. */
    option: string | null
    price: number
    cost: number | null
    isVeg: boolean | null
    description: string | null
    /** Options from the older all-in-one-cell format, or Small/Medium/Large columns. */
    listVariants: { name: string; price: number; cost: number | null }[]
    addons: { name: string; price: number }[]
  }
  const records: RowRec[] = []
  const order: string[] = []
  const seenCategory = new Set<string>()
  let currentCategory: string | null = null
  let skippedInactive = 0

  function noteCategory(name: string) {
    if (!seenCategory.has(name)) {
      seenCategory.add(name)
      order.push(name)
    }
  }

  dataRows.forEach((raw, i) => {
    const rowNum = i + 2 // account for header row + 1-indexing, matches what a user sees in Excel
    const cell = (idx: number) => cellAt(raw, idx)
    const allBlank = raw.every((c) => normalize(c) === '')
    if (allBlank) return // blank rows are silently ignored, as specified
    if (isInactive(cell(activeCol))) {
      skippedInactive++
      return
    }

    // Add-ons carry no cost of their own — menu_item_addons stores a name and a
    // price and nothing else — so a "/margin" suffix here has nowhere to go.
    const readAddons = (label: string) => {
      const opts = parseOptionList(cell(addonsCol), rowNum, label, issues, { allowFree: true })
      for (const o of opts) {
        if (o.margin !== null) {
          issues.push({ row: rowNum, message: `"${label}" — margin on the add-on "${o.name}" isn't tracked, ignored.` })
        }
      }
      return opts.map((o) => ({ name: o.name, price: o.price }))
    }

    const priceRaw = cell(priceCol)
    const option = rowOptionName(raw)

    if (isFlat) {
      const name = text(cell(itemCol))
      if (!name) return // no item name at all — nothing to import from this row
      const label = option ? `${name} — ${option}` : name
      const { price, variants } = resolvePriceAndSizes(raw, priceRaw, rowNum, label, option !== null)
      if (price === null) {
        issues.push({ row: rowNum, message: `"${label}" — missing or invalid price, skipped.` })
        return
      }
      const cat = text(cell(catCol)) || currentCategory || 'Uncategorised'
      if (!text(cell(catCol)) && currentCategory === null) {
        issues.push({ row: rowNum, message: `"${name}" has no category and none carried over — filed under Uncategorised.` })
      }
      currentCategory = cat
      noteCategory(cat)
      records.push({
        row: rowNum,
        category: cat,
        name,
        option,
        price,
        cost: parseCost(raw, rowNum, price),
        isVeg: parseVeg(cell(vegCol), rowNum, issues),
        description: descCol !== -1 ? text(cell(descCol)) || null : null,
        listVariants: variants,
        addons: readAddons(label),
      })
    } else {
      const mergedText = text(cell(mergedCol))
      const priceText = normalize(priceRaw)
      // A row carrying only an old-style list ("Steam 69, Fried 79") has a
      // blank Price, so that cell has to count as "priced" here too or it
      // would be mistaken for a category heading.
      const anySizeFilled =
        (hasSizeCols && sizeCols.some((s) => normalize(cellAt(raw, s.col)) !== '')) ||
        normalize(cell(choicesCol)) !== ''
      if (!mergedText) return

      if (!priceText && !anySizeFilled) {
        // No price and no options → it's a category heading, per spec.
        currentCategory = mergedText
        noteCategory(mergedText)
        return
      }

      const label = option ? `${mergedText} — ${option}` : mergedText
      const { price, variants } = resolvePriceAndSizes(raw, priceRaw, rowNum, label, option !== null)
      if (price === null) {
        issues.push({ row: rowNum, message: `"${label}" — invalid price "${priceRaw}", skipped.` })
        return
      }
      if (currentCategory === null) {
        issues.push({ row: rowNum, message: `"${mergedText}" appears before any category heading — filed under Uncategorised.` })
      }
      const cat = currentCategory ?? 'Uncategorised'
      noteCategory(cat)
      records.push({
        row: rowNum,
        category: cat,
        name: mergedText,
        option,
        price,
        cost: parseCost(raw, rowNum, price),
        isVeg: parseVeg(cell(vegCol), rowNum, issues),
        description: descCol !== -1 ? text(cell(descCol)) || null : null,
        listVariants: variants,
        addons: readAddons(label),
      })
    }
  })

  // ── Rows → items ───────────────────────────────────────────────────────────
  // Rows sharing a category + item name are one item. Keyed rather than
  // position-based, so an item's options stay together even after the sheet has
  // been sorted or filtered — the reason the export repeats the category on
  // every row in the first place.
  const byKey = new Map<string, RowRec[]>()
  const keyOrder: string[] = []
  for (const r of records) {
    const key = `${r.category.toLowerCase()}::${r.name.toLowerCase()}`
    if (!byKey.has(key)) {
      byKey.set(key, [])
      keyOrder.push(key)
    }
    byKey.get(key)!.push(r)
  }

  const itemsByCategory = new Map<string, ParsedItem[]>()
  for (const key of keyOrder) {
    const rows = byKey.get(key)!
    const optionRows = rows.filter((r) => r.option !== null)
    const plainRows = rows.filter((r) => r.option === null)

    // Same option (or the same item twice with no options) listed twice: keep
    // the last, matching how a spreadsheet edit usually reads.
    const dedupe = <T extends { row: number; option: string | null }>(list: T[], what: (t: T) => string) => {
      const seen = new Map<string, T>()
      for (const r of list) {
        const k = (r.option ?? '').toLowerCase()
        const prev = seen.get(k)
        if (prev) {
          issues.push({ row: r.row, message: `${what(r)} appears more than once — using row ${r.row}, ignoring row ${prev.row}.` })
        }
        seen.set(k, r)
      }
      return [...seen.values()]
    }

    const options = dedupe(optionRows, (r) => `"${r.name} — ${r.option}"`)
    const plain = dedupe(plainRows, (r) => `"${r.name}"`)
    const lead = options[0] ?? plain[0]
    if (!lead) continue

    // An item's own price is its first option's; each option's margin then
    // becomes a difference from that, which is exactly how the database stores
    // it (menu_items.cost plus menu_item_variants.cost_delta).
    const variants = options.length > 0
      ? options.map((r) => ({ name: r.option!, price: r.price, cost: r.cost }))
      : lead.listVariants

    // Details belong to the item, not to one of its sizes — take the first row
    // that actually supplies each, so an owner only has to fill them in once.
    const firstWith = <T,>(pick: (r: RowRec) => T | null | undefined): T | null => {
      for (const r of rows) {
        const v = pick(r)
        if (v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)) return v
      }
      return null
    }

    const item: ParsedItem = {
      row: lead.row,
      category: lead.category,
      name: lead.name,
      price: lead.price,
      cost: lead.cost,
      isVeg: firstWith((r) => r.isVeg),
      description: firstWith((r) => r.description),
      variants,
      addons: firstWith((r) => r.addons) ?? [],
    }
    const list = itemsByCategory.get(lead.category) ?? []
    list.push(item)
    itemsByCategory.set(lead.category, list)
  }

  // ── "Add On Burger" categories → add-ons on the burgers ────────────────────
  // A POS with no modifier concept fakes one with a pseudo-category: Petpooja's
  // export has 21 of them ("Add On Burger", "Add On Maggi", "Choice of Mojito")
  // holding 62 rows. Imported literally, a guest sees a category called "Add On
  // Burger" and can order a ₹20 cheese slice on its own.
  //
  // They fold into the add-ons of every item in the category they name. Only
  // when that category actually exists — otherwise the rows stay as items,
  // because dropping a café's data on a guess is worse than an odd category.
  const ADDON_CATEGORY = /^(?:add[\s-]?ons?|choice of|choose)\s+(.+)$/i
  const norm = (s: string) => s.trim().toLowerCase()
  const singular = (s: string) => norm(s).replace(/s$/, '')
  const foldedAddonGroups: ParseResult['foldedAddonGroups'] = []

  for (const catName of [...order]) {
    const m = catName.match(ADDON_CATEGORY)
    const source = itemsByCategory.get(catName)
    if (!m || !source?.length) continue

    const wanted = m[1]
    const candidates = [...itemsByCategory.keys()].filter((k) => k !== catName && !ADDON_CATEGORY.test(k))
    // Exact (then singular/plural) before anything looser, so a near-match can
    // never beat a real one.
    const target =
      candidates.find((k) => norm(k) === norm(wanted)) ??
      candidates.find((k) => singular(k) === singular(wanted)) ??
      // One name being a prefix of the other catches the typos these files are
      // full of — this very export has "Add on cold coffe" against a "Cold
      // Coffee" category. Length-guarded so short words can't collide.
      candidates.find((k) => {
        const [a, b] = [norm(k), norm(wanted)]
        return Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a))
      })
    if (!target) continue

    const extras = source.map((i) => ({ name: i.name, price: i.price }))
    const targetItems = itemsByCategory.get(target)!
    for (const item of targetItems) {
      const have = new Set(item.addons.map((a) => a.name.toLowerCase()))
      // An add-on the item already names wins — it was stated about that item
      // specifically, where these apply to the whole category.
      item.addons = [...item.addons, ...extras.filter((e) => !have.has(e.name.toLowerCase()))]
    }
    itemsByCategory.delete(catName)
    foldedAddonGroups.push({ name: catName, target, addons: extras.length, items: targetItems.length })
  }

  const byCategory = order
    .filter((name) => (itemsByCategory.get(name) ?? []).length > 0)
    .map((name) => ({ name, items: itemsByCategory.get(name)! }))

  const totalItems = byCategory.reduce((s, c) => s + c.items.length, 0)

  return {
    format: isFlat ? 'flat' : 'heading',
    byCategory,
    issues,
    totalItems,
    updateCount: 0,
    insertCount: 0,
    skippedInactive,
    foldedAddonGroups,
  }
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
