'use client'

import { useMemo, useState } from 'react'
import { Package } from 'lucide-react'
import type { Combo, ComboSlot, ComboSelection } from '@/lib/combos'
import { comboPartsTotal } from '@/lib/combos'

export type ComboPickItem = { id: string; name: string; price: number; category_id: string | null; available: boolean }
export type ComboPickVariant = { id: string; menu_item_id: string; name: string; price_delta: number }

const SELECT_CLS =
  'h-11 w-full min-w-0 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[14px] text-foreground'

/**
 * Staff-facing combo builder. One block per slot; a choice slot with qty > 1
 * gets that many pickers so a guest can mix ("any two mojito" = one mint, one
 * classic). Native selects rather than a radio list because a café category
 * can run to dozens of items and this is a speed-first counter screen.
 *
 * Everything here is a preview — expand_combo_line re-resolves and re-prices
 * every component server-side at order time.
 */
export function ComboPicker({
  combo,
  slots,
  items,
  variants,
  onCancel,
  onAdd,
}: {
  combo: Combo
  slots: ComboSlot[]
  items: ComboPickItem[]
  variants: ComboPickVariant[]
  onCancel: () => void
  onAdd: (selections: ComboSelection[]) => void
}) {
  // key = `${slotId}#${index}` so each pick within a multi-qty slot is its own entry
  const [picks, setPicks] = useState<Record<string, { itemId: string; variantId: string | null }>>({})

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const variantsByItem = useMemo(() => {
    const m = new Map<string, ComboPickVariant[]>()
    variants.forEach((v) => m.set(v.menu_item_id, [...(m.get(v.menu_item_id) ?? []), v]))
    return m
  }, [variants])

  const choiceSlots = slots.filter((s) => s.kind === 'choice')
  const fixedSlots = slots.filter((s) => s.kind === 'fixed')

  const selections: ComboSelection[] = useMemo(
    () =>
      Object.entries(picks)
        .filter(([, v]) => v.itemId)
        .map(([key, v]) => ({ slot_id: key.split('#')[0], item_id: v.itemId, variant_id: v.variantId })),
    [picks],
  )

  // Complete = every choice slot filled, and every pick that needs a size has one.
  const complete = useMemo(() => {
    for (const s of choiceSlots) {
      for (let i = 0; i < s.qty; i++) {
        const p = picks[`${s.id}#${i}`]
        if (!p?.itemId) return false
        if ((variantsByItem.get(p.itemId) ?? []).length > 0 && !p.variantId) return false
      }
    }
    return true
  }, [choiceSlots, picks, variantsByItem])

  const priceOf = (itemId: string, variantId: string | null) => {
    const base = itemById.get(itemId)?.price ?? 0
    const delta = variantId ? (variantsByItem.get(itemId) ?? []).find((v) => v.id === variantId)?.price_delta ?? 0 : 0
    return base + delta
  }
  const parts = comboPartsTotal(slots, selections, priceOf)
  const saving = Math.max(0, parts - combo.price)

  function setPick(key: string, itemId: string) {
    setPicks((p) => ({ ...p, [key]: { itemId, variantId: null } }))
  }
  function setPickVariant(key: string, variantId: string) {
    setPicks((p) => ({ ...p, [key]: { itemId: p[key]?.itemId ?? '', variantId: variantId || null } }))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6" role="presentation">
      <div className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-[var(--shadow-lg)] sm:max-h-[85dvh] sm:rounded-[var(--radius-lg)]">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius)] bg-primary-subtle text-primary">
            <Package size={18} />
          </div>
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold text-foreground">{combo.name}</h2>
            {combo.description && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{combo.description}</p>}
          </div>
        </div>

        {fixedSlots.length > 0 && (
          <div className="mt-4 rounded-[var(--radius)] bg-surface-subtle p-3">
            <p className="text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">Included</p>
            <ul className="mt-1.5 space-y-0.5">
              {fixedSlots.map((s) => {
                const item = s.menu_item_id ? itemById.get(s.menu_item_id) : null
                const vName = s.variant_id
                  ? (variantsByItem.get(s.menu_item_id ?? '') ?? []).find((v) => v.id === s.variant_id)?.name
                  : null
                return (
                  <li key={s.id} className="text-[13.5px] text-foreground">
                    {s.qty > 1 ? `${s.qty} × ` : ''}
                    {item?.name ?? s.label}
                    {vName ? ` (${vName})` : ''}
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        <div className="mt-4 space-y-4">
          {choiceSlots.map((s) => {
            const options = items.filter((i) => i.category_id === s.category_id && i.available)
            return (
              <div key={s.id}>
                <p className="text-[13px] font-medium text-foreground">
                  {s.label} <span className="font-normal text-muted-foreground">· choose {s.qty}</span>
                </p>
                {options.length === 0 && (
                  <p className="mt-1 text-[12.5px] text-warning">Nothing available in this category right now.</p>
                )}
                <div className="mt-2 space-y-2">
                  {Array.from({ length: s.qty }).map((_, i) => {
                    const key = `${s.id}#${i}`
                    const pick = picks[key]
                    const pickVariants = pick?.itemId ? (variantsByItem.get(pick.itemId) ?? []) : []
                    return (
                      <div key={key} className="flex gap-2">
                        <select
                          value={pick?.itemId ?? ''}
                          onChange={(e) => setPick(key, e.target.value)}
                          aria-label={`${s.label} — pick ${i + 1}`}
                          className={SELECT_CLS}
                        >
                          <option value="">{s.qty > 1 ? `Pick ${i + 1}…` : 'Choose…'}</option>
                          {options.map((o) => (
                            <option key={o.id} value={o.id}>{o.name}</option>
                          ))}
                        </select>
                        {pickVariants.length > 0 && (
                          <select
                            value={pick?.variantId ?? ''}
                            onChange={(e) => setPickVariant(key, e.target.value)}
                            aria-label="Size"
                            className={`${SELECT_CLS} max-w-[130px]`}
                          >
                            <option value="">Size…</option>
                            {pickVariants.map((v) => (
                              <option key={v.id} value={v.id}>{v.name}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {complete && saving > 0 && (
          <p className="mt-4 rounded-[var(--radius)] bg-success-subtle px-3 py-2 text-[12.5px] font-medium text-success">
            ₹{parts} separately — saves ₹{saving}
          </p>
        )}

        <div className="mt-5 flex gap-2">
          <button
            onClick={onCancel}
            className="min-h-11 flex-1 rounded-[var(--radius)] border border-border-strong text-[14px] font-medium text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={() => onAdd(selections)}
            disabled={!complete}
            className="min-h-11 flex-1 rounded-[var(--radius)] bg-primary text-[14px] font-medium text-primary-foreground disabled:opacity-50"
          >
            Add · ₹{combo.price}
          </button>
        </div>
      </div>
    </div>
  )
}
