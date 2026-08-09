// Shared combo types + pure helpers, used by the menu manager, the POS, and
// the customer QR menu. Kept here rather than duplicated per surface because
// all three build the same cart line and have to agree on what "complete"
// means for a half-configured combo.
//
// Nothing here is authoritative: expand_combo_line (migration 0123) re-resolves
// every component and re-prices it server-side. These helpers only drive the
// picker UI and the optimistic price preview.

export type ComboSlot = {
  id: string
  combo_id: string
  label: string
  kind: 'fixed' | 'choice'
  menu_item_id: string | null
  variant_id: string | null
  category_id: string | null
  qty: number
  sort: number
}

export type Combo = {
  id: string
  name: string
  description: string | null
  price: number
  image_url: string | null
  active: boolean
  sort: number
  /**
   * The owner's own margin figure (migration 0124). Optional here because the
   * POS and QR menu deliberately never select it — it's a back-office number,
   * so it must not travel to a customer's browser.
   */
  margin?: number | null
}

/** One chosen item filling one unit of a choice slot. A slot with qty 2 gets two of these. */
export type ComboSelection = {
  slot_id: string
  item_id: string
  variant_id: string | null
}

export function slotsOf(slots: ComboSlot[], comboId: string): ComboSlot[] {
  return slots.filter((s) => s.combo_id === comboId).sort((a, b) => a.sort - b.sort)
}

/**
 * A combo is orderable once every CHOICE slot has exactly as many picks as it
 * asks for. Fixed slots need nothing from the guest.
 */
export function comboComplete(slots: ComboSlot[], selections: ComboSelection[]): boolean {
  return slots
    .filter((s) => s.kind === 'choice')
    .every((s) => selections.filter((x) => x.slot_id === s.id).length === s.qty)
}

/**
 * Stable cart key. Two differently-configured instances of the same combo are
 * separate cart lines; two identically-configured ones merge and bump qty.
 * Sorted so pick order never forks the line — same reasoning as the sorted
 * addon ids in the plain item key.
 */
export function comboCartKey(comboId: string, selections: ComboSelection[]): string {
  const sig = selections
    .map((s) => `${s.slot_id}:${s.item_id}:${s.variant_id ?? ''}`)
    .sort()
    .join('|')
  return `combo:${comboId}:${sig}`
}

/** "Margherita, Mint Mojito × 2" — what the guest picked, for the cart line. */
export function comboSelectionLabel(
  selections: ComboSelection[],
  nameOf: (itemId: string, variantId: string | null) => string,
): string {
  const counts = new Map<string, number>()
  for (const s of selections) {
    const label = nameOf(s.item_id, s.variant_id)
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts.entries()].map(([label, n]) => (n > 1 ? `${label} × ${n}` : label)).join(', ')
}

/** What the components would cost bought separately — drives the "save ₹X" badge. */
export function comboPartsTotal(
  slots: ComboSlot[],
  selections: ComboSelection[],
  priceOf: (itemId: string, variantId: string | null) => number,
): number {
  let total = 0
  for (const s of slots) {
    if (s.kind === 'fixed' && s.menu_item_id) {
      total += priceOf(s.menu_item_id, s.variant_id) * s.qty
    }
  }
  for (const sel of selections) total += priceOf(sel.item_id, sel.variant_id)
  return total
}
