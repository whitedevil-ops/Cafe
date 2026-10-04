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

/** A size/choice row as the item editor holds it — strings, straight from inputs. */
export type VariantInput = { id?: string; name: string; price: string; margin: string }
/** An add-on row as the item editor holds it. */
export type AddonInput = { id?: string; name: string; price: string }

export type VariantRow = { menu_item_id: string; name: string; price_delta: number; cost_delta: number; sort: number }
export type AddonRow = { menu_item_id: string; name: string; price: number; sort: number }

/**
 * Splits an item's edited sizes and add-ons into the writes that persist them.
 *
 * Rows the editor already knew carry their id and are UPSERTED, so the id that
 * order lines, rewards, combo slots and an open QR menu all point at survives
 * an unrelated edit. Rows that are new carry NO `id` KEY AT ALL.
 *
 * That last part is load-bearing, not tidiness. PostgREST reads a bulk insert's
 * column list from the KEYS of the rows (supabase-js sends it as `?columns=`),
 * and a key whose value is `undefined` is dropped from the JSON body but still
 * counted. `{ ...row, id: undefined }` therefore asks PostgREST to insert NULL
 * into the primary key, and the whole insert fails with `null value in column
 * "id" … violates not-null constraint` — which is how every save that added a
 * new size or add-on broke after the id-preserving rewrite in 3d6ca22 (the
 * delete and upsert steps before it had already run, so the item was left half
 * saved). Building new rows without the key is the only correct shape.
 *
 * Sizes that were left unnamed are dropped, and `sort` follows the order the
 * owner sees, counted over the rows that remain.
 */
export function planOptionWrites(args: {
  itemId: string
  basePrice: number
  baseCost: number | null
  variants: VariantInput[]
  addons: AddonInput[]
}): {
  variants: { update: (VariantRow & { id: string })[]; insert: VariantRow[]; keepIds: string[] }
  addons: { update: (AddonRow & { id: string })[]; insert: AddonRow[]; keepIds: string[] }
} {
  const { itemId, basePrice, baseCost } = args

  const variantUpdate: (VariantRow & { id: string })[] = []
  const variantInsert: VariantRow[] = []
  args.variants
    .filter((v) => v.name.trim())
    .forEach((v, i) => {
      const row: VariantRow = {
        menu_item_id: itemId,
        name: v.name.trim(),
        ...optionToDeltas(basePrice, baseCost, {
          price: Math.round(Number(v.price) || 0),
          margin: v.margin.trim() === '' ? null : Math.round(Number(v.margin) || 0),
        }),
        sort: i,
      }
      if (v.id) variantUpdate.push({ id: v.id, ...row })
      else variantInsert.push(row)
    })

  const addonUpdate: (AddonRow & { id: string })[] = []
  const addonInsert: AddonRow[] = []
  args.addons
    .filter((a) => a.name.trim())
    .forEach((a, i) => {
      const row: AddonRow = {
        menu_item_id: itemId,
        name: a.name.trim(),
        price: Math.max(0, Math.round(Number(a.price) || 0)),
        sort: i,
      }
      if (a.id) addonUpdate.push({ id: a.id, ...row })
      else addonInsert.push(row)
    })

  return {
    variants: { update: variantUpdate, insert: variantInsert, keepIds: variantUpdate.map((v) => v.id) },
    addons: { update: addonUpdate, insert: addonInsert, keepIds: addonUpdate.map((a) => a.id) },
  }
}
