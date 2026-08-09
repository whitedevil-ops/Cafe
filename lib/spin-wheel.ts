// Shared spin-wheel types and the odds arithmetic.
//
// An owner thinks "the free coffee should go to about one guest in twenty".
// The database stores a relative weight per slice. This module is the one
// place that converts between the two, so the dashboard can show real odds as
// they are typed instead of asking anyone to reason about weights.

export type SpinPrizeKind = 'item' | 'percent' | 'flat' | 'none'

export type SpinSegment = {
  id?: string
  label: string
  kind: SpinPrizeKind
  menu_item_id: string | null
  variant_id: string | null
  /** Percent 1–100, or flat rupees. Unused for 'item' and 'none'. */
  value: number
  /** Relative chance. Probability is weight ÷ the total of all weights. */
  weight: number
}

export type SpinWheel = {
  id: string
  cafe_id: string
  title: string
  active: boolean
  expiry_days: number | null
}

/** What a guest actually won, as returned by spin_the_wheel. */
export type SpinPrize = {
  segment_id: string | null
  label: string
  kind: SpinPrizeKind
  value: number
  code: string
  expires_at: string | null
}

/**
 * The chance of one slice, as a fraction of the whole wheel.
 * Zero when nothing can be won, rather than NaN from dividing by zero.
 */
export function chanceOf(weight: number, total: number): number {
  if (total <= 0 || weight <= 0) return 0
  return weight / total
}

export function totalWeight(segments: { weight: number }[]): number {
  return segments.reduce((sum, s) => sum + Math.max(0, s.weight || 0), 0)
}

/**
 * "1 in 20" — the phrasing an owner uses, rounded to something readable.
 * Returns null for a slice that can never be landed on, so the caller can say
 * "never" rather than print "1 in ∞".
 */
export function oneInPhrase(weight: number, total: number): string | null {
  const p = chanceOf(weight, total)
  if (p <= 0) return null
  const n = 1 / p
  // Below 10 the rounded integer is misleading (1 in 2 vs 1 in 1.5), so keep
  // one decimal there and round to something tidy further out.
  if (n < 10) return `1 in ${n.toFixed(1).replace(/\.0$/, '')}`
  if (n < 100) return `1 in ${Math.round(n)}`
  return `1 in ${Math.round(n / 10) * 10}`
}

export function percentPhrase(weight: number, total: number): string {
  const pct = chanceOf(weight, total) * 100
  if (pct <= 0) return '0%'
  return pct < 1 ? `${pct.toFixed(2)}%` : `${pct.toFixed(1)}%`
}

/**
 * Weights that make one slice land roughly once every `oneIn` spins, with the
 * rest of the wheel sharing what's left.
 *
 * Used by the "make this 1 in N" shortcut: the owner names the odds they want
 * for the top prize and the other slices scale around it, instead of being
 * asked to solve for a weight themselves.
 *
 * Returns null when the request is impossible — you cannot give one slice a
 * 1-in-1 chance and still have others, and there must be something else on the
 * wheel to take the remaining share.
 */
export function weightsForOneIn(
  segments: { weight: number }[],
  index: number,
  oneIn: number,
): number[] | null {
  if (!Number.isFinite(oneIn) || oneIn <= 1) return null
  if (index < 0 || index >= segments.length || segments.length < 2) return null

  const others = segments.filter((_, i) => i !== index)
  const othersTotal = totalWeight(others)
  // Every other slice at zero leaves nothing to share the remainder.
  if (othersTotal <= 0) return null

  // Target: w / (w + othersTotal) = 1 / oneIn  →  w = othersTotal / (oneIn - 1)
  const target = Math.max(1, Math.round(othersTotal / (oneIn - 1)))
  return segments.map((s, i) => (i === index ? target : Math.max(0, s.weight || 0)))
}

/** A one-line summary of a prize, for the counter and the guest's screen. */
export function prizeLabel(kind: SpinPrizeKind, value: number, label: string): string {
  switch (kind) {
    case 'percent':
      return `${label} — ${value}% off`
    case 'flat':
      return `${label} — ₹${value} off`
    case 'item':
      return `${label} — free`
    default:
      return label
  }
}
