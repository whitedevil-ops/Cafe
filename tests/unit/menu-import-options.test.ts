import { describe, it, expect } from 'vitest'
import { parseMenuFile, parseOptionList, type ImportIssue } from '@/lib/menu-import'
import { effectiveOptionCost, optionToDeltas, optionFromDeltas } from '@/lib/menu-options'

// Free-form Choices / Add-ons columns. These replaced the fixed
// Small/Medium/Large columns because no fixed set of sizes fits every café:
// one menu's options are S/M/L, the next one's are "6 Slice", "Steam"/"Fried",
// "3 Slices", "With Ice-cream".

// The current format: one row per thing a guest can order, each carrying its
// own price and margin. Rows sharing a category + item name are one item.
describe('menu import — one row per option', () => {
  const SHEET = [
    ['Category / Item', 'Size / Choice', 'Price', 'Margin', 'Add-ons', 'Veg Type', 'Description'],
    ['PIZZA', '', '', '', '', '', ''],
    ['Margherita', '6 Slice', '99', '40', 'Double Cheese 40', 'Veg', 'Tomato and mozzarella'],
    ['Margherita', '8 Slice', '139', '80', '', '', ''],
    ['COLD DRINKS', '', '', '', '', '', ''],
    ['Cold Coffee', 'Small', '89', '50', 'With Ice-cream 29', 'Veg', ''],
    ['Cold Coffee', 'Medium', '119', '60', '', '', ''],
    ['Cold Coffee', 'Large', '149', '75', '', '', ''],
    ['Coca Cola', '', '60', '25', '', 'Veg', ''],
  ]

  it('groups rows sharing an item name into one item with several options', () => {
    const r = parseMenuFile(SHEET)
    expect(r.issues).toEqual([])
    expect(r.totalItems).toBe(3) // Margherita, Cold Coffee, Coca Cola
    const by = Object.fromEntries(r.byCategory.flatMap((c) => c.items).map((i) => [i.name, i]))
    expect(by['Margherita'].variants).toEqual([
      { name: '6 Slice', price: 99, cost: 59 },
      { name: '8 Slice', price: 139, cost: 59 },
    ])
    expect(by['Cold Coffee'].variants).toEqual([
      { name: 'Small', price: 89, cost: 39 },
      { name: 'Medium', price: 119, cost: 59 },
      { name: 'Large', price: 149, cost: 74 },
    ])
    expect(by['Coca Cola'].variants).toEqual([])
  })

  it('takes the item price from its first option', () => {
    const by = Object.fromEntries(parseMenuFile(SHEET).byCategory.flatMap((c) => c.items).map((i) => [i.name, i]))
    expect(by['Margherita'].price).toBe(99)
    expect(by['Cold Coffee'].price).toBe(89)
  })

  it('reads add-ons, veg and description from whichever row supplies them', () => {
    const by = Object.fromEntries(parseMenuFile(SHEET).byCategory.flatMap((c) => c.items).map((i) => [i.name, i]))
    expect(by['Cold Coffee'].addons).toEqual([{ name: 'With Ice-cream', price: 29 }])
    expect(by['Cold Coffee'].isVeg).toBe(true)
    expect(by['Margherita'].description).toBe('Tomato and mozzarella')
  })

  it('keeps an item together even when its rows are not adjacent', () => {
    // What sorting the sheet by price in Excel does. Grouping is by name, not
    // position, so the item survives it.
    const r = parseMenuFile([
      ['Category', 'Item', 'Size / Choice', 'Price', 'Margin'],
      ['COLD DRINKS', 'Cold Coffee', 'Small', '89', '50'],
      ['COLD DRINKS', 'Iced Tea', 'Regular', '99', '40'],
      ['COLD DRINKS', 'Cold Coffee', 'Large', '149', '75'],
    ])
    const by = Object.fromEntries(r.byCategory.flatMap((c) => c.items).map((i) => [i.name, i]))
    expect(by['Cold Coffee'].variants.map((v) => v.name)).toEqual(['Small', 'Large'])
    expect(by['Iced Tea'].variants.map((v) => v.name)).toEqual(['Regular'])
  })

  it('flags the same option listed twice and keeps the last', () => {
    const r = parseMenuFile([
      ['Category', 'Item', 'Size / Choice', 'Price'],
      ['DRINKS', 'Cold Coffee', 'Small', '89'],
      ['DRINKS', 'Cold Coffee', 'Small', '95'],
    ])
    expect(r.byCategory[0].items[0].variants).toEqual([{ name: 'Small', price: 95, cost: null }])
    expect(r.issues.some((i) => /more than once/.test(i.message))).toBe(true)
  })

  it('still lets the same option name exist under two different items', () => {
    const r = parseMenuFile([
      ['Category', 'Item', 'Size / Choice', 'Price'],
      ['DRINKS', 'Cold Coffee', 'Large', '149'],
      ['DRINKS', 'Iced Tea', 'Large', '129'],
    ])
    expect(r.issues).toEqual([])
    expect(r.totalItems).toBe(2)
  })

  it('skips an option row with no price and says so', () => {
    const r = parseMenuFile([
      ['Category', 'Item', 'Size / Choice', 'Price'],
      ['DRINKS', 'Cold Coffee', 'Small', '89'],
      ['DRINKS', 'Cold Coffee', 'Large', ''],
    ])
    expect(r.byCategory[0].items[0].variants).toEqual([{ name: 'Small', price: 89, cost: null }])
    expect(r.issues.some((i) => /Cold Coffee — Large/.test(i.message))).toBe(true)
  })

  it('does not mistake an option row for a category heading', () => {
    const r = parseMenuFile([
      ['Category / Item', 'Size / Choice', 'Price'],
      ['MOMOS', '', ''],
      ['Veg Momos', 'Steam', '69'],
      ['Veg Momos', 'Fried', '79'],
    ])
    expect(r.byCategory.map((c) => c.name)).toEqual(['MOMOS'])
    expect(r.totalItems).toBe(1)
    expect(r.byCategory[0].items[0].variants).toHaveLength(2)
  })
})

describe('parseOptionList', () => {
  const parse = (text: string) => {
    const issues: ImportIssue[] = []
    return { opts: parseOptionList(text, 2, 'Test Item', issues), issues }
  }

  it('reads a comma-separated list of name + price', () => {
    expect(parse('Steam 69, Fried 79').opts).toEqual([
      { name: 'Steam', price: 69, margin: null },
      { name: 'Fried', price: 79, margin: null },
    ])
  })

  it('takes the LAST number as the price, so a name can contain digits', () => {
    expect(parse('6 Slice 99, 8 Slice 139').opts).toEqual([
      { name: '6 Slice', price: 99, margin: null },
      { name: '8 Slice', price: 139, margin: null },
    ])
  })

  it('reads an optional /margin suffix', () => {
    expect(parse('Steam 69/20, Fried 79').opts).toEqual([
      { name: 'Steam', price: 69, margin: 20 },
      { name: 'Fried', price: 79, margin: null },
    ])
  })

  it('accepts the +20 and @30 forms a menu board prints', () => {
    expect(parse('Cheese Slice +20, Injector @30, Extra Dip ₹20').opts).toEqual([
      { name: 'Cheese Slice', price: 20, margin: null },
      { name: 'Injector', price: 30, margin: null },
      { name: 'Extra Dip', price: 20, margin: null },
    ])
  })

  it('splits on semicolons and newlines too (Alt+Enter inside a cell)', () => {
    expect(parse('Steam 69; Fried 79\nSteamed Chilli 89').opts).toHaveLength(3)
  })

  it('returns nothing for a blank cell, without complaining', () => {
    expect(parse('').opts).toEqual([])
    expect(parse('   ').issues).toEqual([])
  })

  it('flags an entry with no price and keeps the rest', () => {
    const { opts, issues } = parse('Steam 69, Fried')
    expect(opts).toEqual([{ name: 'Steam', price: 69, margin: null }])
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toMatch(/couldn't read "Fried"/)
  })

  it('flags a margin above its own price and keeps the option without one', () => {
    const { opts, issues } = parse('Steam 69/200')
    expect(opts).toEqual([{ name: 'Steam', price: 69, margin: null }])
    expect(issues[0].message).toMatch(/margin/i)
  })

  it('keeps the last of a duplicated name, and says so', () => {
    const { opts, issues } = parse('Steam 69, Steam 75')
    expect(opts).toEqual([{ name: 'Steam', price: 75, margin: null }])
    expect(issues[0].message).toMatch(/listed twice/)
  })
})

describe('menu import — Choices column', () => {
  const flat = (choices: string, price: string = '') =>
    parseMenuFile([
      ['Category', 'Item', 'Price', 'Margin', 'Choices (pick one)', 'Add-ons (extras)'],
      ["MOMO'S", 'Veg Momos', price, '', choices, ''],
    ]).byCategory.flatMap((c) => c.items)[0]

  it('maps free-form choices to variants at their full price', () => {
    expect(flat('Steam 69, Fried 79', '69').variants).toEqual([
      { name: 'Steam', price: 69, cost: null },
      { name: 'Fried', price: 79, cost: null },
    ])
  })

  it('uses the first choice as the item price when Price is blank', () => {
    const item = flat('Steam 69, Fried 79')
    expect(item.price).toBe(69)
    // Still listed as a variant: the POS makes you pick one of an item's
    // variants whenever it has any, so dropping it makes it unselectable.
    expect(item.variants).toHaveLength(2)
  })

  it('turns a /margin into that choice\'s absolute cost', () => {
    expect(flat('Steam 69/20, Fried 79/25').variants).toEqual([
      { name: 'Steam', price: 69, cost: 49 },
      { name: 'Fried', price: 79, cost: 54 },
    ])
  })

  it('leaves an item with no choices exactly as before', () => {
    expect(flat('', '179').variants).toEqual([])
  })

  it('treats a heading-format row with only choices as an item, not a category', () => {
    const r = parseMenuFile([
      ['Category / Item', 'Price', 'Choices (pick one)'],
      ["MOMO'S", '', ''],
      ['Veg Momos', '', 'Steam 69, Fried 79'],
    ])
    expect(r.totalItems).toBe(1)
    const item = r.byCategory.flatMap((c) => c.items)[0]
    expect(item.category).toBe("MOMO'S")
    expect(item.price).toBe(69)
  })
})

describe('menu import — Add-ons column', () => {
  const item = (addons: string) =>
    parseMenuFile([
      ['Category', 'Item', 'Price', 'Choices (pick one)', 'Add-ons (extras)'],
      ['BURGERS', 'Classic OG Burger', '49', '', addons],
    ]).byCategory.flatMap((c) => c.items)[0]

  it('reads add-ons as the amount they ADD', () => {
    expect(item('Cheese Slice 20, Extra Dip 20').addons).toEqual([
      { name: 'Cheese Slice', price: 20 },
      { name: 'Extra Dip', price: 20 },
    ])
  })

  it('is empty when the cell is blank', () => {
    expect(item('').addons).toEqual([])
  })

  // A pizza that lets you pick a topping at no charge. The menu board writes
  // the list with slashes and no prices, and that has to import as-is.
  it('reads a price-less add-on as a free extra', () => {
    expect(item('Onion / Corn / Capsicum / Tomato').addons).toEqual([
      { name: 'Onion', price: 0 },
      { name: 'Corn', price: 0 },
      { name: 'Capsicum', price: 0 },
      { name: 'Tomato', price: 0 },
    ])
  })

  it('raises no issue for a free list', () => {
    const r = parseMenuFile([
      ['Category', 'Item', 'Price', 'Add-ons'],
      ['PIZZA', 'Veg Pizza Mania Single Topping', '79', 'Onion / Corn / Capsicum / Tomato'],
    ])
    expect(r.issues).toEqual([])
  })

  it('mixes free and paid extras in one cell', () => {
    expect(item('Onion / Corn, Cheese Slice 20').addons).toEqual([
      { name: 'Onion', price: 0 },
      { name: 'Corn', price: 0 },
      { name: 'Cheese Slice', price: 20 },
    ])
  })

  it('still treats a slash between two numbers as a margin, not a separator', () => {
    const r = parseMenuFile([
      ['Category', 'Item', 'Size / Choice', 'Price', 'Margin'],
      ['DRINKS', 'Cold Coffee', 'Small', '89', '50'],
    ])
    expect(r.issues).toEqual([])
    const list = parseOptionList('Small 89/50, Large 149/75', 2, 'x', [])
    expect(list).toEqual([
      { name: 'Small', price: 89, margin: 50 },
      { name: 'Large', price: 149, margin: 75 },
    ])
  })

  it('does not invent a free size — a size with no price is still an error', () => {
    const issues: ImportIssue[] = []
    expect(parseOptionList('Small, Large', 2, 'Cold Coffee', issues)).toEqual([])
    expect(issues).toHaveLength(2)
  })

  it('flags a margin on an add-on, since add-ons store no cost', () => {
    const r = parseMenuFile([
      ['Category', 'Item', 'Price', 'Add-ons (extras)'],
      ['BURGERS', 'Classic OG Burger', '49', 'Cheese Slice 20/8'],
    ])
    expect(r.byCategory[0].items[0].addons).toEqual([{ name: 'Cheese Slice', price: 20 }])
    expect(r.issues.some((i) => /isn't tracked/.test(i.message))).toBe(true)
  })
})

// The obvious worry on seeing a template with no Small/Medium/Large columns:
// a café that DOES sell by those sizes. Nothing special is needed — they're
// just three more names in the same free-form column.
describe('menu import — a café that does use Small/Medium/Large', () => {
  it('reads S/M/L written in the Choices column like any other names', () => {
    const r = parseMenuFile([
      ['Category', 'Item', 'Price', 'Margin', 'Choices (pick one)', 'Add-ons (extras)'],
      ['COLD DRINKS', 'Cold Coffee', '', '', 'Small 89, Medium 119, Large 149', 'With Ice-cream 29'],
    ])
    const item = r.byCategory.flatMap((c) => c.items)[0]
    expect(r.issues).toEqual([])
    expect(item.price).toBe(89) // first choice becomes the item price
    expect(item.variants).toEqual([
      { name: 'Small', price: 89, cost: null },
      { name: 'Medium', price: 119, cost: null },
      { name: 'Large', price: 149, cost: null },
    ])
    expect(item.addons).toEqual([{ name: 'With Ice-cream', price: 29 }])
  })

  it('carries a per-size margin through the /margin suffix', () => {
    const r = parseMenuFile([
      ['Category / Item', 'Price', 'Choices (pick one)'],
      ['COLD DRINKS', '', ''],
      ['Cold Coffee', '', 'Small 89/50, Medium 119/60, Large 149/75'],
    ])
    expect(r.byCategory[0].items[0].variants).toEqual([
      { name: 'Small', price: 89, cost: 39 },
      { name: 'Medium', price: 119, cost: 59 },
      { name: 'Large', price: 149, cost: 74 },
    ])
  })
})

// Each option can carry its own margin — a Small and a Large, or a Steam and a
// Fried, rarely earn the same. The export side has to mirror what the database
// computes (menu_item_effective_cost, migration 0106) or the sheet and the
// Profitability report disagree.
describe('per-option margins', () => {
  it('gives every choice its own margin through the /margin suffix', () => {
    const r = parseMenuFile([
      ['Category', 'Item', 'Price', 'Margin', 'Choices (pick one)'],
      ["MOMO'S", 'Veg Momos', '', '', 'Steam 69/30, Fried 79/25, Kurkure 99/40'],
    ])
    expect(r.issues).toEqual([])
    expect(r.byCategory[0].items[0].variants).toEqual([
      { name: 'Steam', price: 69, cost: 39 },
      { name: 'Fried', price: 79, cost: 54 },
      { name: 'Kurkure', price: 99, cost: 59 },
    ])
  })

  it('lets some choices carry a margin and others not', () => {
    const r = parseMenuFile([
      ['Category', 'Item', 'Price', 'Choices (pick one)'],
      ['PIZZA', 'Margherita', '99', '6 Slice 99/45, 8 Slice 139'],
    ])
    expect(r.byCategory[0].items[0].variants).toEqual([
      { name: '6 Slice', price: 99, cost: 54 },
      { name: '8 Slice', price: 139, cost: null },
    ])
  })

  // The question the template kept prompting: "where do I write the margin
  // for an item that has sizes?" Answer: the Margin column, same as any other
  // item — it applies even when the price came from the first choice.
  it('applies the plain Margin column to an item priced through its choices', () => {
    const r = parseMenuFile([
      ['Category', 'Item', 'Price', 'Margin', 'Sizes / Choices'],
      ["MOMO'S", 'Veg Momos', '', '25', 'Steam 69, Fried 79'],
    ])
    const item = r.byCategory[0].items[0]
    expect(r.issues).toEqual([])
    expect(item.price).toBe(69)
    expect(item.cost).toBe(44) // 69 − 25, so Steam keeps exactly the ₹25 asked for
    // Choices carry no margin of their own, so they all cost the same to make
    // and the bigger one simply earns more — which is how a café actually works.
    expect(item.variants).toEqual([
      { name: 'Steam', price: 69, cost: null },
      { name: 'Fried', price: 79, cost: null },
    ])
  })

  it('lets a per-size margin sit alongside a Margin column without conflict', () => {
    const r = parseMenuFile([
      ['Category', 'Item', 'Price', 'Margin', 'Sizes / Choices'],
      ['COLD DRINKS', 'Cold Coffee', '', '50', 'Small 89/50, Medium 119/60'],
    ])
    const item = r.byCategory[0].items[0]
    expect(item.cost).toBe(39) // 89 − 50
    expect(item.variants).toEqual([
      { name: 'Small', price: 89, cost: 39 },
      { name: 'Medium', price: 119, cost: 59 },
    ])
  })

  // The per-item editor types the same two numbers the sheet does, and stores
  // them as deltas. Both directions have to agree or editing an item silently
  // shifts its costing.
  describe('option ⇄ delta conversion', () => {
    it('turns a typed price and margin into deltas from the base item', () => {
      expect(optionToDeltas(99, 59, { price: 139, margin: 80 })).toEqual({ price_delta: 40, cost_delta: 0 })
      expect(optionToDeltas(89, 39, { price: 149, margin: 75 })).toEqual({ price_delta: 60, cost_delta: 35 })
    })

    it('leaves cost untouched for an option given no margin', () => {
      expect(optionToDeltas(99, 59, { price: 139, margin: null })).toEqual({ price_delta: 40, cost_delta: 0 })
    })

    it('carries the whole cost on the delta when the item tracks none', () => {
      expect(optionToDeltas(69, null, { price: 79, margin: 35 })).toEqual({ price_delta: 10, cost_delta: 44 })
    })

    it('round-trips every combination back to what was typed', () => {
      const cases: { basePrice: number; baseCost: number | null; price: number; margin: number | null }[] = [
        { basePrice: 99, baseCost: 59, price: 139, margin: 80 },
        { basePrice: 89, baseCost: 39, price: 89, margin: 50 },
        { basePrice: 89, baseCost: 39, price: 149, margin: 75 },
        { basePrice: 69, baseCost: null, price: 79, margin: 35 },
        { basePrice: 149, baseCost: 89, price: 149, margin: null },
      ]
      for (const c of cases) {
        const deltas = optionToDeltas(c.basePrice, c.baseCost, { price: c.price, margin: c.margin })
        const back = optionFromDeltas(c.basePrice, c.baseCost, deltas)
        expect(back.price).toBe(c.price)
        // A margin-less option reads back as "same cost as the base item",
        // which is a real answer rather than a blank once the item has a cost.
        expect(back.margin).toBe(c.margin === null && c.baseCost != null ? c.price - c.baseCost : c.margin)
      }
    })
  })

  describe('effectiveOptionCost mirrors menu_item_effective_cost', () => {
    it('adds the delta to the item cost', () => {
      expect(effectiveOptionCost(89, -50)).toBe(39)
      expect(effectiveOptionCost(50, 25)).toBe(75)
    })

    it('treats a null item cost as 0 when the choice carries a delta', () => {
      // The reported case: margins given on the choices only, item Margin
      // blank. The delta holds the whole cost and must still show up.
      expect(effectiveOptionCost(null, 39)).toBe(39)
    })

    it('is null only when neither side records anything', () => {
      expect(effectiveOptionCost(null, 0)).toBeNull()
    })

    it('clamps below zero, exactly as greatest(0, ...) does in SQL', () => {
      expect(effectiveOptionCost(20, -50)).toBe(0)
    })

    it('keeps a zero item cost distinct from no item cost', () => {
      expect(effectiveOptionCost(0, 0)).toBe(0)
    })
  })
})

describe('menu import — backward compatibility', () => {
  it('still reads a sheet that only has Small/Medium/Large columns', () => {
    const r = parseMenuFile([
      ['Category', 'Item', 'Price', 'Small', 'Medium', 'Large'],
      ['Drinks', 'Cold Coffee', '', '80', '110', '130'],
    ])
    const item = r.byCategory.flatMap((c) => c.items)[0]
    expect(item.price).toBe(80)
    expect(item.variants.map((v) => v.name)).toEqual(['Small', 'Medium', 'Large'])
    expect(item.addons).toEqual([])
  })

  it('prefers the Choices column when a sheet somehow has both', () => {
    const r = parseMenuFile([
      ['Category', 'Item', 'Price', 'Choices (pick one)', 'Small', 'Large'],
      ['Pizza', 'Margherita', '99', '6 Slice 99, 8 Slice 139', '80', '130'],
    ])
    expect(r.byCategory[0].items[0].variants.map((v) => v.name)).toEqual(['6 Slice', '8 Slice'])
  })

  it('falls back to the size columns for a row whose Choices cell is empty', () => {
    const r = parseMenuFile([
      ['Category', 'Item', 'Price', 'Choices (pick one)', 'Small', 'Large'],
      ['Pizza', 'Margherita', '99', '6 Slice 99', '', ''],
      ['Drinks', 'Cold Coffee', '80', '', '80', '130'],
    ])
    const items = r.byCategory.flatMap((c) => c.items)
    expect(items[0].variants.map((v) => v.name)).toEqual(['6 Slice'])
    expect(items[1].variants.map((v) => v.name)).toEqual(['Small', 'Large'])
  })
})

// The menu that prompted this format: none of its options are S/M/L.
describe('menu import — a real café menu with none of the old fixed sizes', () => {
  it('imports burgers, pizza, momos, coffee and mojitos in one sheet', () => {
    const r = parseMenuFile([
      ['Category', 'Item', 'Price', 'Margin', 'Choices (pick one)', 'Add-ons (extras)', 'Veg Type'],
      ['BURGER', 'Classic OG Burger', '49', '20', '', 'Cheese Slice 20', 'Veg'],
      ['PIZZA', 'Margherita', '99', '', '6 Slice 99', 'Double Cheese 40', 'Veg'],
      ['GARLIC BREAD', 'Cheese Garlic Bread', '89', '', '3 Slices 89', 'Cheese Slice 30', 'Veg'],
      ["MOMO'S", 'Veg Momos', '', '', 'Steam 69, Fried 79', 'Extra Dip 20', 'Veg'],
      ['COLD COFFEE', 'Premium Cold Coffee', '59', '25', '', 'With Ice-cream 29', 'Veg'],
      ['MOJITO', 'Surprise Mojito', '49', '', '', 'Injector 30', 'Veg'],
    ])
    expect(r.issues).toEqual([])
    expect(r.totalItems).toBe(6)
    const by = Object.fromEntries(r.byCategory.flatMap((c) => c.items).map((i) => [i.name, i]))

    expect(by['Classic OG Burger'].cost).toBe(29) // 49 − margin 20
    expect(by['Classic OG Burger'].addons).toEqual([{ name: 'Cheese Slice', price: 20 }])
    expect(by['Margherita'].variants).toEqual([{ name: '6 Slice', price: 99, cost: null }])
    expect(by['Cheese Garlic Bread'].variants).toEqual([{ name: '3 Slices', price: 89, cost: null }])
    expect(by['Veg Momos'].price).toBe(69) // no Price cell — first choice wins
    expect(by['Veg Momos'].variants.map((v) => v.name)).toEqual(['Steam', 'Fried'])
    expect(by['Premium Cold Coffee'].addons).toEqual([{ name: 'With Ice-cream', price: 29 }])
    expect(by['Surprise Mojito'].addons).toEqual([{ name: 'Injector', price: 30 }])
  })
})
