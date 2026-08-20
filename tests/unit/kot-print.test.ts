// The kitchen ticket is the one document a cook reads under pressure, and the
// browser print path gives no feedback — a wrong ticket just quietly comes out
// wrong. These guard the rules that matter on paper.
import { describe, it, expect } from 'vitest'
import { kotHtml, kotUpdateHtml, type KotTicket, type KotUpdateTicket } from '@/lib/kot-print'

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
  it('leads with the table as the biggest thing on the ticket, order number secondary', () => {
    const html = kotHtml(base)
    expect(html).toContain('#42')
    // The table is the hero — deliberately uppercased, the most prominent
    // text on the ticket (spec: "make the table number extremely
    // prominent"), not the same title-cased text as a meta line.
    expect(html).toContain('TABLE T08')
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
    expect(html).toContain('>2&times;<')
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

  it('gives an order-level note its own distinct KITCHEN NOTE callout', () => {
    const html = kotHtml({ ...base, orderNote: 'no peanuts' })
    // A separate, bordered callout with its own header — spec: "do not bury
    // notes in small text", must never blend into the rest of the ticket.
    expect(html).toContain('KITCHEN NOTE')
    expect(html).toContain('NO PEANUTS')
    expect(html).toContain('notebox')
    expect(kotHtml(base)).not.toContain('KITCHEN NOTE')
  })
})

describe('kotUpdateHtml', () => {
  const updateBase: KotUpdateTicket = {
    kotNumber: '42',
    tableLabel: 'T08',
    orderType: 'dine_in',
    placedAt: '2026-07-23T14:12:00Z',
    timezone: 'Asia/Kolkata',
    paperWidth: '58mm',
    added: [{ qty: 1, name: 'Cold Coffee' }],
    removed: [{ qty: 1, name: 'Burger' }],
  }

  it('is visually marked as an update, never mistakable for a new order', () => {
    const html = kotUpdateHtml(updateBase)
    expect(html).toContain('KOT UPDATE')
  })

  it('marks added items with + and removed items with -', () => {
    const html = kotUpdateHtml(updateBase)
    expect(html).toContain('+ 1&times;')
    expect(html).toContain('Cold Coffee')
    expect(html).toContain('- 1&times;')
    expect(html).toContain('Burger')
  })

  it('never prints money on an update ticket either', () => {
    const html = kotUpdateHtml(updateBase)
    expect(html).not.toContain('₹')
  })
})
