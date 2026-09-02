// The kitchen ticket is the one document a cook reads under pressure, and the
// browser print path gives no feedback — a wrong ticket just quietly comes out
// wrong. These guard the rules that matter on paper.
import { describe, it, expect } from 'vitest'
import { kotHtml, kotUpdateHtml, type KotTicket, type KotUpdateTicket } from '@/lib/kot-print'

/** Just the printed ticket, with the stylesheet cut away. An assertion about
 * what a cook reads must not be satisfied — or broken — by a word that only
 * ever appears in a CSS comment. */
const paper = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/, '')

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
  it('leads with the table as the biggest thing on the ticket, KOT number secondary', () => {
    const html = kotHtml(base)
    // Spelled out, not a bare "#42": the number staff call out and search a
    // rail for has to survive being read off a crumpled ticket.
    expect(html).toContain('KOT #42')
    // The table is the hero — deliberately uppercased, the most prominent
    // text on the ticket (spec: "make the table number extremely
    // prominent"), not the same title-cased text as a meta line.
    expect(html).toContain('TABLE T08')
  })

  it('formats the ordered date and time in the café zone, not the machine zone', () => {
    const html = kotHtml(base)
    expect(html).toContain('23 JUL 2026 - 7:42')
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

  it('heads the list with its columns so a number is never ambiguous', () => {
    const html = kotHtml(base)
    expect(html).toContain('>QTY<')
    expect(html).toContain('>ITEM<')
  })

  it('carries every item with its quantity, modifiers and note', () => {
    const html = kotHtml(base)
    expect(html).toContain('Veg Burger')
    expect(html).toContain('>2&times;<')
    expect(html).toContain('Extra Cheese')
    expect(html).toContain('NOTE: NO ONION')
    expect(html).toContain('Fries')
  })

  it('marks a modifier as going on or coming off the dish', () => {
    const html = kotHtml({
      ...base,
      items: [{ qty: 1, name: 'Pizza', modifiers: ['Extra Cheese', 'No Olives', 'without ice'] }],
    })
    expect(html).toContain('+ Extra Cheese')
    // "no"/"without" phrasing is the only signal free-text modifiers carry,
    // and a cook adding olives to a no-olives pizza is a remake.
    expect(html).toContain('- No Olives')
    expect(html).toContain('- without ice')
  })

  it('never prints money — a KOT is an instruction, not a bill', () => {
    const html = paper(kotHtml(base))
    expect(html).not.toContain('₹')
    expect(html.toLowerCase()).not.toContain('total')
  })

  it('marks takeaway instead of inventing a table', () => {
    const html = paper(kotHtml({ ...base, orderType: 'takeaway', tableLabel: null }))
    expect(html).toContain('TAKEAWAY')
    expect(html).not.toContain('Table')
  })

  it('does not repeat the order type when the hero line already says it', () => {
    // No table, so "TAKEAWAY" is already the hero — printing it again
    // underneath reads as a rendering fault, not as emphasis.
    const takeaway = paper(kotHtml({ ...base, orderType: 'takeaway', tableLabel: null }))
    expect(takeaway.match(/TAKEAWAY/g)).toHaveLength(1)
    // With a table the hero is the table, so the order type still has to
    // appear somewhere or a dine-in ticket never says it is dine-in.
    expect(kotHtml(base)).toContain('>DINE-IN<')
  })

  it('shows the source and station only when the order has them', () => {
    const html = paper(kotHtml({ ...base, source: 'qr', station: 'bar' }))
    expect(html).toContain('SOURCE: QR')
    expect(html).toContain('STATION: BAR')
    // Nothing to say, so no empty labels rather than "SOURCE: —".
    expect(paper(kotHtml(base))).not.toContain('SOURCE')
    expect(paper(kotHtml(base))).not.toContain('STATION')
  })

  it('announces what kind of ticket it is, so a reprint is never cooked twice', () => {
    expect(paper(kotHtml({ ...base, status: 'NEW ORDER' }))).toContain('*** NEW ORDER ***')
    expect(paper(kotHtml({ ...base, status: 'reprint' }))).toContain('*** REPRINT ***')
    // A test ticket carries no status and needs none — it explains itself.
    expect(paper(kotHtml(base))).not.toContain('***')
  })

  it('repeats the whole ticket per copy, and clamps a silly count', () => {
    const two = kotHtml({ ...base, copies: 2 })
    expect(two.match(/KOT #42/g)).toHaveLength(2)
    expect(kotHtml({ ...base, copies: 0 }).match(/KOT #42/g)).toHaveLength(1)
    expect(kotHtml({ ...base, copies: 99 }).match(/KOT #42/g)).toHaveLength(5)
  })

  it('numbers the copies so two tickets are never read as two orders', () => {
    const two = paper(kotHtml({ ...base, copies: 2 }))
    expect(two).toContain('COPY 1/2')
    expect(two).toContain('COPY 2/2')
    // A single ticket has nothing to distinguish itself from.
    expect(paper(kotHtml(base))).not.toContain('COPY')
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

  it("shows the café's own name, never the platform's", () => {
    const withName = paper(kotHtml({ ...base, cafeName: 'Brewora' }))
    expect(withName).toContain('Brewora')
    expect(withName).not.toContain('KhaoPiyo')
    // No name given — omit the bar rather than falling back to the platform brand.
    expect(paper(kotHtml(base))).not.toContain('brandbar')
    expect(paper(kotHtml(base))).not.toContain('KhaoPiyo')
  })

  it('gives an order-level note its own unmissable callout', () => {
    const html = paper(kotHtml({ ...base, orderNote: 'no peanuts' }))
    // A separate, bordered callout with its own header — spec: "do not bury
    // notes in small text", must never blend into the rest of the ticket.
    expect(html).toContain('!!! ORDER NOTE !!!')
    expect(html).toContain('NO PEANUTS')
    expect(html).toContain('notebox')
    expect(paper(kotHtml(base))).not.toContain('ORDER NOTE')
  })

  it('lets a long dish name wrap instead of running off the roll', () => {
    const html = kotHtml({
      ...base,
      items: [{ qty: 1, name: 'Supercalifragilisticexpialidociousness Paneer Tikka Masala' }],
    })
    expect(html).toContain('Supercalifragilisticexpialidociousness')
    // A flex child will not shrink below its longest word without these two,
    // and one unbroken name would print past the edge of the paper.
    expect(html).toContain('min-width: 0')
    expect(html).toContain('overflow-wrap: anywhere')
  })

  it('holds a long ticket without dropping items', () => {
    const items = Array.from({ length: 24 }, (_, n) => ({ qty: n + 1, name: `Dish ${n + 1}` }))
    const html = kotHtml({ ...base, items })
    for (const i of items) expect(html).toContain(i.name)
    expect(html.match(/class="item"/g)).toHaveLength(24)
  })

  it('survives a ticket with nothing optional on it', () => {
    const bare = kotHtml({
      kotNumber: '7',
      placedAt: base.placedAt,
      timezone: base.timezone,
      items: [{ qty: 1, name: 'Chai' }],
    })
    expect(bare).toContain('KOT #7')
    expect(bare).toContain('Chai')
    // No table and no order type at all still has to name something.
    expect(bare).toContain('DINE-IN')
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
    expect(paper(kotUpdateHtml(updateBase))).toContain('*** KOT UPDATE ***')
  })

  it('splits the change into ADDED and REMOVED, and says to cook only the change', () => {
    const html = kotUpdateHtml(updateBase)
    expect(html).toContain('>ADDED<')
    expect(html).toContain('>REMOVED<')
    // Without this the slip reads as a short order and the lot gets re-fired.
    expect(html).toContain('PREPARE CHANGES ONLY')
  })

  it('prints only the section that has something in it', () => {
    const addOnly = kotUpdateHtml({ ...updateBase, removed: [] })
    expect(addOnly).toContain('>ADDED<')
    // An empty "REMOVED" heading sends a cook looking for what is missing.
    expect(addOnly).not.toContain('>REMOVED<')
    const rmOnly = kotUpdateHtml({ ...updateBase, added: [] })
    expect(rmOnly).toContain('>REMOVED<')
    expect(rmOnly).not.toContain('>ADDED<')
  })

  it('marks added items with + and removed items with -', () => {
    const html = kotUpdateHtml(updateBase)
    expect(html).toContain('+ 1&times;')
    expect(html).toContain('Cold Coffee')
    expect(html).toContain('- 1&times;')
    expect(html).toContain('Burger')
  })

  it('names the change, not the channel the order first arrived on', () => {
    // A change slip is caused by someone editing the order, so "SOURCE: QR"
    // would credit the wrong thing.
    expect(paper(kotUpdateHtml({ ...updateBase, source: 'qr' }))).not.toContain('SOURCE')
  })

  it('numbers its copies too', () => {
    const two = paper(kotUpdateHtml({ ...updateBase, copies: 2 }))
    expect(two).toContain('COPY 1/2')
    expect(two).toContain('COPY 2/2')
  })

  it('never prints money on an update ticket either', () => {
    const html = paper(kotUpdateHtml(updateBase))
    expect(html).not.toContain('₹')
    expect(html.toLowerCase()).not.toContain('total')
  })
})
