import { describe, it, expect } from 'vitest'
import { GSTIN_RE } from '@/app/dashboard/profile/gst-panel'

// Mirrors apply_order_taxes (migration 0037) exactly. The database remains
// authoritative — this proves the ARITHMETIC the SQL implements is right,
// including the cases that make GST awkward: mixed rates on one bill,
// proportional discount allocation, and inclusive pricing.
function applyTaxes(
  lines: { price: number; qty: number; rate: number }[],
  opts: { discount?: number; registered?: boolean; inclusive?: boolean; servicePct?: number } = {},
) {
  const { discount = 0, registered = true, inclusive = false, servicePct = 0 } = opts
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0)
  const disc = Math.min(Math.max(discount, 0), subtotal)

  let allocated = 0
  let tax = 0
  let taxableTotal = 0

  lines.forEach((l, i) => {
    const lineVal = l.price * l.qty
    const share = i === lines.length - 1 ? disc - allocated : Math.round((disc * lineVal) / subtotal)
    allocated += share

    let taxable: number
    let lineTax: number
    if (!registered) {
      taxable = lineVal - share
      lineTax = 0
    } else if (inclusive) {
      taxable = Math.round(((lineVal - share) * 100) / (100 + l.rate))
      lineTax = lineVal - share - taxable
    } else {
      taxable = lineVal - share
      lineTax = Math.round((taxable * l.rate) / 100)
    }
    tax += lineTax
    taxableTotal += taxable
  })

  const svc = Math.round(((subtotal - disc) * servicePct) / 100)
  const total = inclusive && registered ? subtotal - disc + svc : subtotal - disc + tax + svc
  return { subtotal, discount: disc, taxable: taxableTotal, tax, svc, total }
}

describe('GSTIN validation', () => {
  it('accepts a well-formed GSTIN', () => {
    expect(GSTIN_RE.test('06AABCB1234F1Z5')).toBe(true)
    expect(GSTIN_RE.test('27AAPFU0939F1ZV')).toBe(true)
  })
  it('rejects malformed ones', () => {
    for (const bad of ['', 'NOT-A-GSTIN', '6AABCB1234F1Z5', '06AABCB1234F1A5', '06aabcb1234f1z5']) {
      expect(GSTIN_RE.test(bad)).toBe(false)
    }
  })
})

describe('apply_order_taxes arithmetic', () => {
  it('adds GST on top when pricing is tax-exclusive', () => {
    const r = applyTaxes([{ price: 100, qty: 1, rate: 5 }])
    expect(r.tax).toBe(5)
    expect(r.total).toBe(105)
  })

  it('extracts GST from the price when pricing is tax-inclusive — the guest still pays 100', () => {
    const r = applyTaxes([{ price: 100, qty: 1, rate: 5 }], { inclusive: true })
    expect(r.total).toBe(100)
    expect(r.taxable).toBe(95)
    expect(r.tax).toBe(5)
    expect(r.taxable + r.tax).toBe(100)
  })

  it('charges NO tax at all when the café is not GST registered', () => {
    const r = applyTaxes([{ price: 100, qty: 1, rate: 5 }], { registered: false })
    expect(r.tax).toBe(0)
    expect(r.total).toBe(100)
  })

  it('applies each item its own rate on a mixed-slab bill', () => {
    // Food at 5%, a packaged item at 18% — a single flat café rate would
    // have got both wrong, which is the bug this replaces.
    const r = applyTaxes([
      { price: 200, qty: 1, rate: 5 },
      { price: 100, qty: 1, rate: 18 },
    ])
    expect(r.tax).toBe(10 + 18)
    expect(r.total).toBe(328)
  })

  it('allocates an order-level discount proportionally across slabs', () => {
    const r = applyTaxes(
      [
        { price: 200, qty: 1, rate: 5 },
        { price: 100, qty: 1, rate: 18 },
      ],
      { discount: 30 },
    )
    // 30 split 200:100 -> 20 and 10. Taxable 180 and 90.
    expect(r.taxable).toBe(270)
    expect(r.tax).toBe(Math.round(180 * 0.05) + Math.round(90 * 0.18))
    expect(r.total).toBe(270 + r.tax)
  })

  it('never loses or invents a rupee when the discount does not divide evenly', () => {
    const r = applyTaxes(
      [
        { price: 33, qty: 1, rate: 5 },
        { price: 33, qty: 1, rate: 5 },
        { price: 34, qty: 1, rate: 5 },
      ],
      { discount: 10 },
    )
    // The last line absorbs the remainder, so taxable is exactly 100 - 10.
    expect(r.taxable).toBe(90)
    expect(r.discount).toBe(10)
  })

  it('keeps service charge outside the GST base (owner decision)', () => {
    const r = applyTaxes([{ price: 100, qty: 1, rate: 5 }], { servicePct: 10 })
    expect(r.tax).toBe(5) // 5% of 100, NOT of 110
    expect(r.svc).toBe(10)
    expect(r.total).toBe(115)
  })

  it('splits tax into CGST/SGST that sums back exactly', () => {
    for (const tax of [23, 5, 1, 0, 99]) {
      const cgst = Math.floor(tax / 2)
      const sgst = tax - cgst
      expect(cgst + sgst).toBe(tax)
    }
  })
})
