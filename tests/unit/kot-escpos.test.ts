// A faithful TS port of desktop/src-tauri/src/escpos.rs's own test suite —
// same assertions, same fixture shape as tests/unit/kot-print.test.ts, so a
// ticket printed over Bluetooth from the browser matches what the desktop
// app's native path already produces.
import { describe, it, expect } from 'vitest'
import { kotEscPos, kotUpdateEscPos } from '@/lib/kot-escpos'
import type { KotTicket, KotUpdateTicket } from '@/lib/kot-print'

const ESC = 0x1b
const GS = 0x1d

/** Decodes the raw ESC/POS bytes into just their printable text, stripping
 * the handful of control sequences this file emits — mirrors escpos.rs's own
 * `as_text` test helper exactly, including which control sequences it knows
 * the byte-length of. Miss one and its parameter byte lands in the decoded
 * text as a stray control character, silently corrupting every assertion. */
function asText(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  while (i < bytes.length) {
    const b = bytes[i]
    if (b === ESC) {
      const next = bytes[i + 1]
      i += next === 0x40 ? 2 : next === 0x45 || next === 0x61 || next === 0x64 ? 3 : 2
    } else if (b === GS) {
      const next = bytes[i + 1]
      // GS ! n (size) and GS B n (reverse video) are three bytes, GS V m n four.
      i += next === 0x21 || next === 0x42 ? 3 : next === 0x56 ? 4 : 2
    } else {
      out += String.fromCharCode(b)
      i += 1
    }
  }
  return out
}

const base: KotTicket = {
  kotNumber: '42',
  tableLabel: 'T08',
  orderType: 'dine_in',
  placedAt: '2026-07-23T14:12:00Z', // 7:42 PM in Asia/Kolkata
  timezone: 'Asia/Kolkata',
  paperWidth: '58mm',
  items: [{ qty: 2, name: 'Veg Burger', modifiers: ['Extra Cheese'], note: 'no onion' }],
  cafeName: 'Brewora',
  status: 'NEW ORDER',
}

const baseUpdate: KotUpdateTicket = {
  kotNumber: '42',
  tableLabel: 'T08',
  orderType: 'dine_in',
  placedAt: base.placedAt,
  timezone: base.timezone,
  paperWidth: '58mm',
  added: [{ qty: 1, name: 'Cold Coffee' }],
  removed: [{ qty: 1, name: 'Burger' }],
  cafeName: 'Brewora',
}

describe('kotEscPos', () => {
  it('starts by initialising and ends by cutting', () => {
    const out = kotEscPos(base)
    expect([...out.slice(0, 2)]).toEqual([ESC, 0x40])
    expect([...out.slice(-4)]).toEqual([GS, 0x56, 66, 0])
  })

  it('carries the order number, items and notes', () => {
    const text = asText(kotEscPos(base))
    expect(text).toContain('KOT #42')
    expect(text).toContain('TABLE T08')
    expect(text).toContain('7:42')
    expect(text).toContain('2 x Veg Burger')
    expect(text).toContain('+ Extra Cheese')
    expect(text).toContain('NOTE: NO ONION')
  })

  it('heads the item list with its columns', () => {
    expect(asText(kotEscPos(base))).toContain('QTY  ITEM')
  })

  it('signs a modifier by its own wording', () => {
    const t = {
      ...base,
      items: [{
        qty: 1,
        name: 'Veg Burger',
        // "no" only counts as a whole word, and an already-signed modifier
        // must not come out as "- - pickles".
        modifiers: ['Extra Cheese', 'No Onion', 'without mayo', '- pickles', 'Nonstick pan'],
      }],
    }
    const text = asText(kotEscPos(t))
    expect(text).toContain('+ Extra Cheese')
    expect(text).toContain('- No Onion')
    expect(text).toContain('- without mayo')
    expect(text).toContain('- pickles')
    expect(text).toContain('+ Nonstick pan')
  })

  it('dates the meta line with the order time, not the print time', () => {
    // 23 Jul 2026 in Asia/Kolkata — a reprint tomorrow must still say this.
    expect(asText(kotEscPos(base))).toContain('23 JUL 2026 - 7:42 PM')
  })

  it('shows the status line when one is given', () => {
    expect(asText(kotEscPos(base))).toContain('*** NEW ORDER ***')
    expect(asText(kotEscPos({ ...base, status: 'REPRINT' }))).toContain('*** REPRINT ***')
  })

  it('omits the status line when there is none', () => {
    // A test ticket has no status: it is self-explanatory without one.
    expect(asText(kotEscPos({ ...base, status: null }))).not.toContain('***')
  })

  it('never prints money', () => {
    const text = asText(kotEscPos(base)).toLowerCase()
    for (const word of ['total', 'subtotal', 'gst', 'discount', 'payment']) {
      expect(text, `a KOT is not a bill; found ${word}`).not.toContain(word)
    }
  })

  it('marks takeaway rather than inventing a table', () => {
    const text = asText(kotEscPos({ ...base, orderType: 'takeaway', tableLabel: null }))
    expect(text).toContain('TAKEAWAY')
    expect(text).not.toContain('Table')
  })

  it('rules span the paper width', () => {
    expect(asText(kotEscPos(base))).toContain('-'.repeat(32))
    expect(asText(kotEscPos({ ...base, paperWidth: '80mm' }))).toContain('-'.repeat(48))
  })

  it('repeats per copy and clamps a silly count', () => {
    expect(asText(kotEscPos({ ...base, copies: 2 })).match(/#42/g)?.length).toBe(2)
    expect(asText(kotEscPos({ ...base, copies: 0 })).match(/#42/g)?.length).toBe(1)
    expect(asText(kotEscPos({ ...base, copies: 99 })).match(/#42/g)?.length).toBe(5)
  })

  it('numbers the copies only when there is more than one', () => {
    expect(asText(kotEscPos(base))).not.toContain('COPY')
    const text = asText(kotEscPos({ ...base, copies: 2 }))
    expect(text).toContain('COPY 1/2')
    expect(text).toContain('COPY 2/2')
  })

  it('wraps long names instead of letting the printer truncate', () => {
    const t = { ...base, items: [{ qty: 2, name: 'Cold Coffee with Ice Cream and Extra Chocolate Sauce' }] }
    for (const line of asText(kotEscPos(t)).split('\n')) {
      expect(line.length, `line too long for 58mm: ${JSON.stringify(line)}`).toBeLessThanOrEqual(40)
    }
  })

  it('keeps a twenty-item ticket inside the paper width', () => {
    const t: KotTicket = {
      ...base,
      orderNote: 'ring the bell when the whole table is ready to go out together',
      items: Array.from({ length: 20 }, (_, i) => ({
        qty: i + 1,
        name: `Paneer Tikka Masala with Extra Butter Naan number ${i + 1}`,
        modifiers: ['no green chilli at all please', 'extra gravy on the side'],
        note: 'this one goes to the child at the corner of the table',
      })),
    }
    for (const line of asText(kotEscPos(t)).split('\n')) {
      expect(line.length, `line too long for 58mm: ${JSON.stringify(line)}`).toBeLessThanOrEqual(32)
    }
  })

  it('strips characters the printer cannot render', () => {
    const t = { ...base, items: [{ qty: 1, name: 'Café — ₹pecial' }] }
    const text = asText(kotEscPos(t))
    expect(text).not.toContain('₹')
    expect(text).not.toContain('—')
    expect(text).toContain('Caf?')
  })

  it('header carries the order source', () => {
    expect(asText(kotEscPos({ ...base, source: 'qr' }))).toContain('SOURCE: QR')
  })

  it('header carries the station when there is one', () => {
    expect(asText(kotEscPos(base))).not.toContain('STATION')
    expect(asText(kotEscPos({ ...base, station: 'bar' }))).toContain('STATION: BAR')
  })

  it("shows the café's own name, not the platform's", () => {
    const text = asText(kotEscPos(base))
    expect(text).toContain('Brewora')
    expect(text).not.toContain('KhaoPiyo')
  })

  it('omits the cafe name line when none is given', () => {
    expect(asText(kotEscPos({ ...base, cafeName: null }))).not.toContain('KhaoPiyo')
  })

  it('prints a reverse-video brand bar padded to the full paper width', () => {
    const bytes = kotEscPos(base)
    // The brand bar is the very first thing after ESC @ (init): align left —
    // the name is padded to the full width itself, so the fill reaches both
    // edges — then GS B 1 (reverse on), bold on, then the uppercased name.
    expect([...bytes.slice(2, 5)]).toEqual([ESC, 0x61, 0])
    const seq = [...bytes]
    expect(seq.join(',')).toContain([GS, 0x42, 1].join(','))
    expect(seq.join(',')).toContain([GS, 0x42, 0].join(','))
    const bar = asText(bytes).split('\n')[0]
    expect(bar.length).toBe(32)
    expect(bar.trim()).toBe('BREWORA')
  })

  it('omits the brand bar entirely when no cafe name is given', () => {
    const seq = [...kotEscPos({ ...base, cafeName: null })].join(',')
    expect(seq, 'no cafe name means reverse video never turns on').not.toContain([GS, 0x42, 1].join(','))
  })

  it('separates multiple items with a dotted rule, and a single one with none', () => {
    const two = asText(kotEscPos({ ...base, items: [...base.items, { qty: 1, name: 'Cold Coffee' }] }))
    expect(two.match(/\.{32}/g)?.length).toBe(1)
    expect(asText(kotEscPos(base))).not.toContain('.'.repeat(32))
  })

  it('wraps a long order note without overflowing the paper width', () => {
    const t = {
      ...base,
      orderNote: 'please make it extra spicy and pack the sauces separately in a small container on the side',
    }
    const text = asText(kotEscPos(t))
    expect(text).toContain('!!! ORDER NOTE !!!')
    expect(text).toContain('PACK THE SAUCES')
    for (const line of text.split('\n')) {
      expect(line.length, `line too long for 58mm: ${JSON.stringify(line)}`).toBeLessThanOrEqual(32)
    }
  })

  it('strips non-ascii from modifiers and notes without throwing', () => {
    const t = { ...base, items: [{ qty: 2, name: 'Veg Burger', modifiers: ['Extra ₹pice — café style'], note: 'café note — ₹' }] }
    const text = asText(kotEscPos(t))
    expect(text).not.toContain('₹')
    expect(text).not.toContain('—')
    expect(text).toContain('caf?')
    expect(text).toContain('CAF?')
  })
})

describe('kotUpdateEscPos', () => {
  it('marks added and removed items in their own sections', () => {
    const text = asText(kotUpdateEscPos(baseUpdate))
    expect(text).toContain('*** KOT UPDATE ***')
    expect(text).toContain('ADDED')
    expect(text).toContain('+ 1 x Cold Coffee')
    expect(text).toContain('REMOVED')
    expect(text).toContain('- 1 x Burger')
    expect(text).toContain('PREPARE CHANGES ONLY')
  })

  it('omits a section with nothing in it', () => {
    const added = asText(kotUpdateEscPos({ ...baseUpdate, removed: [] }))
    expect(added).toContain('ADDED')
    expect(added).not.toContain('REMOVED')
    const removed = asText(kotUpdateEscPos({ ...baseUpdate, added: [] }))
    expect(removed).toContain('REMOVED')
    expect(removed).not.toContain('ADDED')
  })

  it('numbers its copies too', () => {
    const text = asText(kotUpdateEscPos({ ...baseUpdate, copies: 2 }))
    expect(text).toContain('COPY 1/2')
    expect(text).toContain('COPY 2/2')
  })

  it('never prints money either', () => {
    const text = asText(kotUpdateEscPos(baseUpdate)).toLowerCase()
    for (const word of ['total', 'subtotal', 'gst', 'discount', 'payment']) {
      expect(text, `a KOT is not a bill; found ${word}`).not.toContain(word)
    }
  })

  it('stays inside the paper width with long names, modifiers and notes', () => {
    const t: KotUpdateTicket = {
      ...baseUpdate,
      added: [{
        qty: 1,
        name: 'Cold Coffee with Ice Cream and Extra Chocolate Sauce',
        modifiers: ['no sugar in either of the two glasses please'],
        note: 'the second one is for the child at the corner of the table',
      }],
      orderNote: 'the whole order goes out together, nothing before that',
    }
    for (const line of asText(kotUpdateEscPos(t)).split('\n')) {
      expect(line.length, `line too long for 58mm: ${JSON.stringify(line)}`).toBeLessThanOrEqual(32)
    }
  })
})
