import { describe, it, expect } from 'vitest'
import { visionItemsToRows, visionProvider, VISION_HEADER, type VisionItem } from '@/lib/menu-vision'
import { parseMenuFile } from '@/lib/menu-import'

// The vision call itself needs an API key, so what's tested here is everything
// around it: the shaping of a reply into sheet rows, and the fact that those
// rows go through the ordinary importer with every existing safeguard intact.

describe('visionProvider', () => {
  it('picks whichever key the deployment has', () => {
    expect(visionProvider({ ANTHROPIC_API_KEY: 'x' })).toBe('anthropic')
    expect(visionProvider({ OPENAI_API_KEY: 'x' })).toBe('openai')
    expect(visionProvider({})).toBeNull()
  })

  it('prefers Anthropic when both are set, rather than guessing', () => {
    expect(visionProvider({ ANTHROPIC_API_KEY: 'x', OPENAI_API_KEY: 'y' })).toBe('anthropic')
  })
})

describe('visionItemsToRows', () => {
  it('emits the same header the importer already reads', () => {
    expect(visionItemsToRows([])[0]).toEqual(VISION_HEADER)
  })

  it('shapes an item into a row', () => {
    const rows = visionItemsToRows([
      { category: 'BURGER', name: 'Classic OG Burger', price: 49, veg: true, addons: 'Cheese Slice 20', description: 'Crispy patty' },
    ])
    expect(rows[1]).toEqual(['BURGER', 'Classic OG Burger', '', 49, 'Cheese Slice 20', 'Veg', 'Crispy patty'])
  })

  it('drops a row the model could not price, rather than inventing one', () => {
    const rows = visionItemsToRows([
      { category: 'PIZZA', name: 'Margherita', price: 99 },
      { category: 'PIZZA', name: 'Unreadable', price: null },
    ])
    expect(rows).toHaveLength(2)
    expect(rows[1][1]).toBe('Margherita')
  })

  it('drops a nameless row', () => {
    expect(visionItemsToRows([{ category: 'PIZZA', name: '  ', price: 99 }])).toHaveLength(1)
  })

  it('rejects a negative price', () => {
    expect(visionItemsToRows([{ category: 'X', name: 'Odd', price: -5 }])).toHaveLength(1)
  })

  it('files an item with no category under Uncategorised rather than losing it', () => {
    const rows = visionItemsToRows([{ category: '', name: 'Chai', price: 20 }])
    expect(rows[1][0]).toBe('Uncategorised')
  })

  it('maps veg, non-veg and unknown', () => {
    const rows = visionItemsToRows([
      { category: 'X', name: 'A', price: 1, veg: true },
      { category: 'X', name: 'B', price: 1, veg: false },
      { category: 'X', name: 'C', price: 1, veg: null },
    ])
    expect(rows.slice(1).map((r) => r[5])).toEqual(['Veg', 'Non-Veg', ''])
  })
})

// The point of returning rows rather than records: a photo goes through the
// exact same parser a spreadsheet does.
describe('a scanned menu through the ordinary importer', () => {
  // Roughly what the Zorko board would yield.
  const items: VisionItem[] = [
    { category: 'BURGER', name: 'Classic OG Burger', price: 49, veg: true, addons: 'Cheese Slice 20' },
    { category: 'BURGER', name: 'Korean Burger', price: 69, veg: true, addons: 'Cheese Slice 20' },
    { category: 'PIZZA', name: 'Margherita', option: '6 Slice', price: 99, veg: true, addons: 'Double Cheese 40' },
    { category: 'PIZZA', name: 'Margherita', option: '8 Slice', price: 139, veg: true },
    { category: "MOMO'S", name: 'Veg Momos', option: 'Steam', price: 69, veg: true },
    { category: "MOMO'S", name: 'Veg Momos', option: 'Fried', price: 79, veg: true },
    { category: 'PIZZA', name: 'Veg Pizza Mania', price: 79, veg: true, addons: 'Onion, Corn, Capsicum, Tomato' },
  ]

  it('groups options under one item and keeps add-ons', () => {
    const r = parseMenuFile(visionItemsToRows(items))
    expect(r.issues).toEqual([])
    expect(r.totalItems).toBe(5) // 2 burgers, Margherita, Veg Momos, Veg Pizza Mania
    const by = Object.fromEntries(r.byCategory.flatMap((c) => c.items).map((i) => [i.name, i]))

    expect(by['Margherita'].variants).toEqual([
      { name: '6 Slice', price: 99, cost: null },
      { name: '8 Slice', price: 139, cost: null },
    ])
    expect(by['Veg Momos'].price).toBe(69)
    expect(by['Veg Momos'].variants.map((v) => v.name)).toEqual(['Steam', 'Fried'])
    expect(by['Classic OG Burger'].addons).toEqual([{ name: 'Cheese Slice', price: 20 }])
    // Free toppings survive the whole path.
    expect(by['Veg Pizza Mania'].addons.map((a) => a.price)).toEqual([0, 0, 0, 0])
  })

  it('keeps the categories the photo showed', () => {
    const r = parseMenuFile(visionItemsToRows(items))
    expect(r.byCategory.map((c) => c.name)).toEqual(['BURGER', 'PIZZA', "MOMO'S"])
  })

  it('still reports a duplicate the model saw twice', () => {
    const r = parseMenuFile(
      visionItemsToRows([
        { category: 'PIZZA', name: 'Margherita', price: 99 },
        { category: 'PIZZA', name: 'Margherita', price: 129 },
      ]),
    )
    expect(r.totalItems).toBe(1)
    expect(r.issues.some((i) => /more than once/.test(i.message))).toBe(true)
  })
})
