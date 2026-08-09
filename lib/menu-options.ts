// The one place that converts between how an owner thinks about an option and
// how the database stores it.
//
// An owner names a size and gives it two numbers: the price a guest pays and
// the margin they keep. The database stores neither — menu_item_variants holds
// price_delta and cost_delta, both differences from the base item, because
// menu_item_effective_cost (migration 0106) resolves a sold line as
// `greatest(0, coalesce(menu_items.cost, 0) + variant.cost_delta)`.
//
// Both the bulk importer and the per-item editor need that conversion, in both
// directions, and getting it wrong silently corrupts costing rather than
// failing — so it lives here once, with tests, instead of being re-derived.

/**
 * What one option actually costs, mirroring menu_item_effective_cost.
 *
 * A null base cost is treated as 0 whenever the option carries a delta of its
 * own: an owner can record margins on the sizes alone and leave the item's own
 * cost blank, and those margins must still count. Null only when neither side
 * records anything.
 */
export function effectiveOptionCost(baseCost: number | null, costDelta: number): number | null {
  if (baseCost == null && costDelta === 0) return null
  return Math.max(0, (baseCost ?? 0) + costDelta)
}

/** Owner's numbers → the deltas stored on menu_item_variants. */
export function optionToDeltas(
  basePrice: number,
  baseCost: number | null,
  option: { price: number; margin: number | null },
): { price_delta: number; cost_delta: number } {
  return {
    price_delta: option.price - basePrice,
    // No margin given means this option costs the same to make as the base
    // item — the same default as adding a variant by hand.
    cost_delta: option.margin === null ? 0 : option.price - option.margin - (baseCost ?? 0),
  }
}

/** Stored deltas → the two numbers an owner recognises. */
export function optionFromDeltas(
  basePrice: number,
  baseCost: number | null,
  variant: { price_delta: number; cost_delta: number },
): { price: number; margin: number | null } {
  const price = basePrice + variant.price_delta
  const cost = effectiveOptionCost(baseCost, variant.cost_delta)
  return { price, margin: cost == null ? null : price - cost }
}
