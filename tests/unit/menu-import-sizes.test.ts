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
      { name: 'Small', price: 80 },
      { name: 'Medium', price: 110 },
      { name: 'Large', price: 130 },
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
      { name: 'Medium', price: 110 },
      { name: 'Large', price: 130 },
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
    expect(item.variants).toEqual([{ name: 'Medium', price: 120 }])
  })

  it('flags an invalid size price but keeps the item and its other valid sizes', () => {
    const rows = [
      ['Category', 'Item', 'Price', 'Small', 'Medium', 'Large'],
      ['Drinks', 'Cold Coffee', '80', '80', 'oops', '130'],
    ]
    const r = parseMenuFile(rows)
    const item = r.byCategory.flatMap((c) => c.items)[0]
    expect(item.price).toBe(80)
    expect(item.variants).toEqual([{ name: 'Small', price: 80 }, { name: 'Large', price: 130 }])
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
    expect(item.variants).toEqual([{ name: 'Medium', price: 110 }, { name: 'Large', price: 130 }])
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
