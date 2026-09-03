/**
 * What a bill's "Discount" line should say it came from.
 *
 * A single ₹ figure on a bill can be a manual staff discount, a coupon, a
 * spin prize, or two of those stacked — staff_place_order adds them into one
 * `orders.discount` number (migration 0154), so the amount alone never says
 * which. Reported live: a guest's bill read "Discount −₹8" with nothing to
 * say the ₹8 was their spin prize, not a coupon or a manager's goodwill knock.
 *
 * Used identically by the customer receipt (app/r/[token]/page.tsx), its PDF
 * export (lib/pdf-export.ts) and the staff bill drawer
 * (app/dashboard/bills/bill-detail-drawer.tsx) so the three never drift.
 */
export function describeDiscount(couponCode: string | null | undefined, spinPrizeLabel: string | null | undefined): string | null {
  const parts = [couponCode, spinPrizeLabel].filter((p): p is string => Boolean(p && p.trim()))
  return parts.length ? parts.join(' + ') : null
}
