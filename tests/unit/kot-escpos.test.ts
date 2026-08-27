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
 * the byte-length of. */
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
      i += next === 0x21 ? 3 : next === 0x56 ? 4 : 2
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
}

describe('kotEscPos', () => {
  it('starts by initialising and ends by cutting', () => {
    const out = kotEscPos(base)
    expect([...out.slice(0, 2)]).toEqual([ESC, 0x40])
    expect([...out.slice(-4)]).toEqual([GS, 0x56, 66, 0])
  })

  it('carries the order number, items and notes', () => {
    const text = asText(kotEscPos(base))
    expect(text).toContain('#42')
    expect(text).toContain('TABLE T08')
    expect(text).toContain('7:42')
    expect(text).toContain('2 x Veg Burger')
    expect(text).toContain('Extra Cheese')
    expect(text).toContain('NO ONION')
  })

  it('never prints money', () => {
    expect(asText(kotEscPos(base)).toLowerCase()).not.toContain('total')
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

  it('wraps long names instead of letting the printer truncate', () => {
    const t = { ...base, items: [{ qty: 2, name: 'Cold Coffee with Ice Cream and Extra Chocolate Sauce' }] }
    for (const line of asText(kotEscPos(t)).split('\n')) {
      expect(line.length, `line too long for 58mm: ${JSON.stringify(line)}`).toBeLessThanOrEqual(40)
    }
  })

  it('strips characters the printer cannot render', () => {
    const t = { ...base, items: [{ qty: 1, name: 'Café — ₹pecial' }] }
    const text = asText(kotEscPos(t))
    expect(text).not.toContain('₹')
    expect(text).not.toContain('—')
    expect(text).toContain('Caf?')
  })

  it('footer carries the order source', () => {
    expect(asText(kotEscPos({ ...base, source: 'qr' }))).toContain('QR')
  })

  it("footer shows the café's own name, not the platform's", () => {
    const text = asText(kotEscPos(base))
    expect(text).toContain('Brewora')
    expect(text).not.toContain('KhaoPiyo')
  })

  it('footer omits the cafe name line when none is given', () => {
    expect(asText(kotEscPos({ ...base, cafeName: null }))).not.toContain('KhaoPiyo')
  })

  it('wraps a long kitchen note without overflowing the paper width', () => {
    const t = {
      ...base,
      orderNote: 'please make it extra spicy and pack the sauces separately in a small container on the side',
    }
    const text = asText(kotEscPos(t))
    expect(text).toContain('KITCHEN NOTE')
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
  it('marks added and removed items', () => {
    const t: KotUpdateTicket = {
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
    const text = asText(kotUpdateEscPos(t))
    expect(text).toContain('KOT UPDATE')
    expect(text).toContain('+ 1 x Cold Coffee')
    expect(text).toContain('- 1 x Burger')
  })
})
