// The kitchen ticket is the one document a cook reads under pressure, and the
// browser print path gives no feedback — a wrong ticket just quietly comes out
// wrong. These guard the rules that matter on paper.
import { describe, it, expect } from 'vitest'
import { kotHtml, type KotTicket } from '@/lib/kot-print'

const base: KotTicket = {
  kotNumber: '42',
  tableLabel: 'T08',
  orderType: 'dine_in',
  // 14:12 UTC is 19:42 in Asia/Kolkata — a zone bug shows up as 2:12 pm.
  placedAt: '2026-07-23T14:12:00Z',
  timezone: 'Asia/Kolkata',
  paperWidth: '58mm',
  items: [
    { qty: 2, name: 'Veg Burger', modifiers: ['Extra Cheese'], note: 'no onion' },
    { qty: 1, name: 'Fries' },
  ],
}

describe('kotHtml', () => {
  it('leads with the order number and the table', () => {
    const html = kotHtml(base)
    expect(html).toContain('#42')
    expect(html).toContain('Table T08')
  })

  it('formats the time in the café zone, not the machine zone', () => {
    const html = kotHtml(base)
    expect(html).toContain('7:42')
    expect(html, 'UTC leaking through would print 2:12').not.toContain('2:12')
  })

  it('sets the page and body to the chosen roll width', () => {
    expect(kotHtml(base)).toContain('size: 58mm auto')
    expect(kotHtml({ ...base, paperWidth: '80mm' })).toContain('size: 80mm auto')
    // 58mm paper prints ~48mm wide; getting this wrong clips every line.
    expect(kotHtml(base)).toContain('width: 48mm')
    expect(kotHtml({ ...base, paperWidth: '80mm' })).toContain('width: 72mm')
  })

  it('defaults to 58mm when no width is given', () => {
    expect(kotHtml({ ...base, paperWidth: undefined })).toContain('size: 58mm auto')
  })

  it('carries every item with its quantity, modifiers and note', () => {
    const html = kotHtml(base)
    expect(html).toContain('Veg Burger')
    expect(html).toContain('>2<')
    expect(html).toContain('Extra Cheese')
    expect(html).toContain('NO ONION')
    expect(html).toContain('Fries')
  })

  it('never prints money — a KOT is an instruction, not a bill', () => {
    const html = kotHtml(base)
    expect(html).not.toContain('₹')
    expect(html.toLowerCase()).not.toContain('total')
  })

  it('marks takeaway instead of inventing a table', () => {
    const html = kotHtml({ ...base, orderType: 'takeaway', tableLabel: null })
    expect(html).toContain('TAKEAWAY')
    expect(html).not.toContain('Table')
  })

  it('repeats the whole ticket per copy, and clamps a silly count', () => {
    const two = kotHtml({ ...base, copies: 2 })
    expect(two.match(/#42/g)).toHaveLength(2)
    expect(kotHtml({ ...base, copies: 0 }).match(/#42/g)).toHaveLength(1)
    expect(kotHtml({ ...base, copies: 99 }).match(/#42/g)).toHaveLength(5)
  })

  it('escapes item names — they are café-typed and land in markup', () => {
    const html = kotHtml({
      ...base,
      items: [{ qty: 1, name: '<img src=x onerror=alert(1)>', note: 'a & b' }],
    })
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
    expect(html).toContain('A &amp; B')
  })

  it('includes an order-level note when there is one', () => {
    expect(kotHtml({ ...base, orderNote: 'no peanuts' })).toContain('NOTE: NO PEANUTS')
    expect(kotHtml(base)).not.toContain('NOTE:')
  })
})
