import type { CartLine, MenuItem } from './types'

export function subtotal(lines: CartLine[]) {
  return lines.reduce((sum, l) => sum + l.item.price * l.qty, 0)
}

export function pickUpsell(
  lines: CartLine[],
  menu: MenuItem[],
  threshold: number,
): MenuItem | null {
  if (lines.length === 0) return null
  if (subtotal(lines) < threshold) return null

  // Already took something off the upsell shelf. Asking again is nagging.
  if (lines.some((l) => l.item.is_upsell)) return null

  const candidates = menu.filter((m) => m.is_upsell && m.available)
  if (candidates.length === 0) return null

  // Cheapest candidate, and exactly one. A carousel of three suggestions reads as a
  // nag and drops take rate; the offer has to feel like a nudge, not a sales pitch.
  return candidates.reduce((a, b) => (a.price <= b.price ? a : b))
}
