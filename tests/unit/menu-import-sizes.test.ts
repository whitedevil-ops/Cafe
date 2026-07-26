import { describe, it, expect } from 'vitest'
import { parseMenuFile } from '@/lib/menu-import'

// Small/Medium/Large columns — optional per-item size pricing, mapped to
// variants (absolute size price → base price + delta) at write time.
describe('menu import — optional size columns (flat format)', () => {
  it('keeps single-price items unaffected when no size column is filled', () => {
    const rows = [
      ['Category', 'Item', 'Price', 'Small', 'Medium', 'Large'],
      ['Burgers', 'Cheese Burger', '179', '', '', ''],
    ]
    const r = parseMenuFile(rows)
    const item = r.byCategory.flatMap((c) => c.items)[0]
    expect(item.price).toBe(179)
    expect(item.variants).toEqual([])
  })

  it('maps filled size columns to variants against an explicit Price base', () => {
    const rows = [
      ['Category', 'Item', 'Price', 'Small', 'Medium', 'Large'],
      ['Drinks', 'Cold Coffee', '80', '80', '110', '130'],
    ]
    const r = parseMenuFile(rows)
    const item = r.byCategory.flatMap((c) => c.items)[0]
    expect(item.price).toBe(80)
    expect(item.variants).toEqual([
      { name: 'Small', price: 80, cost: null },
      { name: 'Medium', price: 110, cost: null },
      { name: 'Large', price: 130, cost: null },
    ])
  })

  it('uses the first filled size as the base price when Price is blank, without a redundant self-variant', () => {
    const rows = [
      ['Category', 'Item', 'Price', 'Small', 'Medium', 'Large'],
      ['Drinks', 'Cold Coffee', '', '80', '110', '130'],
    ]
    const r = parseMenuFile(rows)
    const item = r.byCategory.flatMap((c) => c.items)[0]
    expect(item.price).toBe(80)
    expect(item.variants).toEqual([
      { name: 'Medium', price: 110, cost: null },
      { name: 'Large', price: 130, cost: null },
    ])
  })

  it('maps only whichever sizes are filled, leaving the rest out', () => {
    const rows = [
      ['Category', 'Item', 'Price', 'Small', 'Medium', 'Large'],
      ['Drinks', 'Cold Coffee', '90', '', '120', ''],
    ]
    const r = parseMenuFile(rows)
    const item = r.byCategory.flatMap((c) => c.items)[0]
    expect(item.price).toBe(90)
    expect(item.variants).toEqual([{ name: 'Medium', price: 120, cost: null }])
  })

  it('flags an invalid size price but keeps the item and its other valid sizes', () => {
    const rows = [
      ['Category', 'Item', 'Price', 'Small', 'Medium', 'Large'],
      ['Drinks', 'Cold Coffee', '80', '80', 'oops', '130'],
    ]
    const r = parseMenuFile(rows)
    const item = r.byCategory.flatMap((c) => c.items)[0]
    expect(item.price).toBe(80)
    expect(item.variants).toEqual([{ name: 'Small', price: 80, cost: null }, { name: 'Large', price: 130, cost: null }])
    expect(r.issues.some((i) => /medium/i.test(i.message))).toBe(true)
  })
})

describe('menu import — optional size columns (heading format)', () => {
  it('treats a row as an item, not a category heading, when a size is filled but Price is blank', () => {
    const rows = [
      ['Category / Item', 'Price', 'Small', 'Medium', 'Large'],
      ['DRINKS', '', '', '', ''],
      ['Cold Coffee', '', '80', '110', '130'],
    ]
    const r = parseMenuFile(rows)
    expect(r.totalItems).toBe(1)
    const item = r.byCategory.flatMap((c) => c.items)[0]
    expect(item.name).toBe('Cold Coffee')
    expect(item.category).toBe('DRINKS')
    expect(item.price).toBe(80)
    expect(item.variants).toEqual([{ name: 'Medium', price: 110, cost: null }, { name: 'Large', price: 130, cost: null }])
  })

  it('still treats a fully blank row as a category heading', () => {
    const rows = [
      ['Category / Item', 'Price', 'Small', 'Medium', 'Large'],
      ['BURGERS', '', '', '', ''],
      ['Cheese Burger', '179', '', '', ''],
    ]
    const r = parseMenuFile(rows)
    expect(r.byCategory).toHaveLength(1)
    expect(r.byCategory[0].name).toBe('BURGERS')
    expect(r.byCategory[0].items[0].variants).toEqual([])
  })
})

// Per-size cost/profit — "Small Cost"/"Medium Cost"/"Large Cost" (or Profit)
// give each size its own absolute cost, independent of the item's own
// Cost/Profit column, without the two ever cross-matching each other.
describe('menu import — optional per-size cost/profit columns', () => {
  it('reads a per-size Cost column as that size\'s absolute cost', () => {
    const rows = [
      ['Category', 'Item', 'Price', 'Small', 'Small Cost', 'Large', 'Large Cost'],
      ['Drinks', 'Cold Coffee', '80', '80', '30', '130', '55'],
    ]
    const r = parseMenuFile(rows)
    const item = r.byCategory.flatMap((c) => c.items)[0]
    expect(item.variants).toEqual([
      { name: 'Small', price: 80, cost: 30 },
      { name: 'Large', price: 130, cost: 55 },
    ])
  })

  it('derives per-size cost from a per-size Profit column: cost = size price - size profit', () => {
    const rows = [
      ['Category', 'Item', 'Price', 'Small', 'Small Profit', 'Large', 'Large Profit'],
      ['Drinks', 'Cold Coffee', '80', '80', '50', '130', '75'],
    ]
    const r = parseMenuFile(rows)
    const item = r.byCategory.flatMap((c) => c.items)[0]
    expect(item.variants).toEqual([
      { name: 'Small', price: 80, cost: 30 },
      { name: 'Large', price: 130, cost: 55 },
    ])
  })

  it('does not let a per-size Cost/Profit column get mistaken for the item\'s own Cost/Profit', () => {
    const rows = [
      ['Category', 'Item', 'Price', 'Profit', 'Small', 'Small Cost', 'Large', 'Large Cost'],
      ['Drinks', 'Cold Coffee', '80', '20', '80', '30', '130', '55'],
    ]
    const r = parseMenuFile(rows)
    const item = r.byCategory.flatMap((c) => c.items)[0]
    expect(item.cost).toBe(60) // item's own Profit column: 80 - 20
    expect(item.variants).toEqual([
      { name: 'Small', price: 80, cost: 30 },
      { name: 'Large', price: 130, cost: 55 },
    ])
  })

  it('leaves a size\'s cost null when only its price is filled', () => {
    const rows = [
      ['Category', 'Item', 'Price', 'Small', 'Small Cost', 'Large'],
      ['Drinks', 'Cold Coffee', '80', '80', '', '130'],
    ]
    const r = parseMenuFile(rows)
    const item = r.byCategory.flatMap((c) => c.items)[0]
    expect(item.variants).toEqual([
      { name: 'Small', price: 80, cost: null },
      { name: 'Large', price: 130, cost: null },
    ])
  })

  it('flags a per-size profit greater than that size\'s price and leaves its cost unset', () => {
    const rows = [
      ['Category', 'Item', 'Price', 'Small', 'Small Profit'],
      ['Drinks', 'Cold Coffee', '80', '80', '200'],
    ]
    const r = parseMenuFile(rows)
    const item = r.byCategory.flatMap((c) => c.items)[0]
    expect(item.variants).toEqual([{ name: 'Small', price: 80, cost: null }])
    expect(r.issues.some((i) => /profit/i.test(i.message))).toBe(true)
  })
})
