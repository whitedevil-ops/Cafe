import { describe, it, expect } from 'vitest'
import { parseMenuFile } from '@/lib/menu-import'

// #5 — optional Cost Price column on menu import. Existing files (no cost
// column) must keep working; invalid costs are flagged, not fatal.
describe('menu import — optional cost price', () => {
  it('parses a Cost Price column without treating it as the selling price', () => {
    const rows = [
      ['Category', 'Item', 'Price', 'Cost Price'],
      ['Burger', 'Paneer Burger', '149', '59'],
      ['Coffee', 'Cold Coffee', '119', '42'],
    ]
    const r = parseMenuFile(rows)
    const items = r.byCategory.flatMap((c) => c.items)
    const paneer = items.find((i) => i.name === 'Paneer Burger')!
    expect(paneer.price).toBe(149) // NOT 59 — cost must not be read as price
    expect(paneer.cost).toBe(59)
    expect(items.find((i) => i.name === 'Cold Coffee')!.cost).toBe(42)
  })

  it('keeps working when there is no cost column (cost = null)', () => {
    const rows = [
      ['Category', 'Item', 'Price'],
      ['Burger', 'Veg Burger', '129'],
    ]
    const r = parseMenuFile(rows)
    const item = r.byCategory.flatMap((c) => c.items)[0]
    expect(item.price).toBe(129)
    expect(item.cost).toBeNull()
  })

  it('flags an invalid cost and leaves it unset rather than failing the row', () => {
    const rows = [
      ['Category', 'Item', 'Price', 'Cost'],
      ['Burger', 'Cheese Burger', '159', '-5'],
    ]
    const r = parseMenuFile(rows)
    const item = r.byCategory.flatMap((c) => c.items)[0]
    expect(item.price).toBe(159) // row still imports
    expect(item.cost).toBeNull() // bad cost dropped
    expect(r.issues.some((i) => /cost/i.test(i.message))).toBe(true)
  })
})

describe('menu import — optional profit column (alternative to cost)', () => {
  it('derives cost from a Profit column: cost = price - profit', () => {
    const rows = [
      ['Category', 'Item', 'Price', 'Profit'],
      ['Burger', 'Paneer Burger', '149', '89'],
    ]
    const r = parseMenuFile(rows)
    const item = r.byCategory.flatMap((c) => c.items)[0]
    expect(item.price).toBe(149)
    expect(item.cost).toBe(60) // 149 - 89
  })

  it('prefers an explicit Cost Price column over Profit when both are present', () => {
    const rows = [
      ['Category', 'Item', 'Price', 'Cost Price', 'Profit'],
      ['Burger', 'Paneer Burger', '149', '59', '89'],
    ]
    const r = parseMenuFile(rows)
    const item = r.byCategory.flatMap((c) => c.items)[0]
    expect(item.cost).toBe(59) // Cost Price wins, not 149 - 89 = 60
  })

  it('flags a profit greater than the price and leaves cost unset', () => {
    const rows = [
      ['Category', 'Item', 'Price', 'Profit'],
      ['Burger', 'Cheese Burger', '159', '200'],
    ]
    const r = parseMenuFile(rows)
    const item = r.byCategory.flatMap((c) => c.items)[0]
    expect(item.price).toBe(159)
    expect(item.cost).toBeNull()
    expect(r.issues.some((i) => /profit/i.test(i.message))).toBe(true)
  })
})
