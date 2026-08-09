'use client'

import { useEffect, useMemo, useState } from 'react'
import { Minus, Plus, X, Package } from 'lucide-react'
import type { Combo, ComboSlot, ComboSelection } from '@/lib/combos'
import { comboPartsTotal } from '@/lib/combos'
import { VegDot } from '@/components/ui/food-image'

export type ComboSheetItem = {
  id: string
  name: string
  price: number
  category_id: string | null
  is_veg: boolean | null
  available: boolean
}
export type ComboSheetVariant = { id: string; menu_item_id: string; name: string; price_delta: number }

/**
 * Guest-facing combo builder. Mirrors ItemSheet's shell — bottom sheet,
 * scroll-lock, Escape to close, live total, one onAdd callback — with a
 * section per slot instead of a single variant radio group.
 *
 * Choices render as tap targets rather than a dropdown: this is a phone, and
 * the guest is browsing rather than ringing up an order at speed.
 */
export function ComboSheet({
  combo,
  slots,
  items,
  variants,
  onClose,
  onAdd,
}: {
  combo: Combo
  slots: ComboSlot[]
  items: ComboSheetItem[]
  variants: ComboSheetVariant[]
  onClose: () => void
  onAdd: (args: { selections: ComboSelection[]; qty: number }) => void
}) {
  // key = `${slotId}#${index}` — one entry per pick within a multi-qty slot
  const [picks, setPicks] = useState<Record<string, { itemId: string; variantId: string | null }>>({})
  const [qty, setQty] = useState(1)

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const variantsByItem = useMemo(() => {
    const m = new Map<string, ComboSheetVariant[]>()
    variants.forEach((v) => m.set(v.menu_item_id, [...(m.get(v.menu_item_id) ?? []), v]))
    return m
  }, [variants])

  const fixedSlots = slots.filter((s) => s.kind === 'fixed')
  const choiceSlots = slots.filter((s) => s.kind === 'choice')

  const selections: ComboSelection[] = useMemo(
    () =>
      Object.entries(picks)
        .filter(([, v]) => v.itemId)
        .map(([key, v]) => ({ slot_id: key.split('#')[0], item_id: v.itemId, variant_id: v.variantId })),
    [picks],
  )

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-surface sm:max-h-[88dvh] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={combo.name}
      >
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex items-start justify-between gap-3 border-b border-border p-5">
            <div className="flex min-w-0 items-start gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius)] bg-primary-subtle text-primary">
                <Package size={20} />
              </div>
              <div className="min-w-0">
                <h2 className="text-[17px] font-semibold text-foreground">{combo.name}</h2>
                {combo.description && <p className="mt-0.5 text-[13px] text-muted-foreground">{combo.description}</p>}
                <p className="mt-1 text-[15px] font-semibold text-primary">₹{combo.price}</p>
              </div>
            </div>
            <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-subtle text-muted-foreground">
              <X size={18} />
            </button>
          </div>

          <div className="p-5">
            {fixedSlots.length > 0 && (
              <div className="rounded-[var(--radius)] bg-surface-subtle p-3.5">
                <p className="text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">Included</p>
                <ul className="mt-2 space-y-1">
                  {fixedSlots.map((s) => {
                    const item = s.menu_item_id ? itemById.get(s.menu_item_id) : null
                    const vName = s.variant_id
                      ? (variantsByItem.get(s.menu_item_id ?? '') ?? []).find((v) => v.id === s.variant_id)?.name
                      : null
                    return (
                      <li key={s.id} className="flex items-center gap-1.5 text-[13.5px] text-foreground">
                        {item?.is_veg != null && <VegDot isVeg={item.is_veg} />}
                        {s.qty > 1 ? `${s.qty} × ` : ''}
                        {item?.name ?? s.label}
                        {vName ? ` (${vName})` : ''}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}

            {choiceSlots.map((s) => {
              const options = items.filter((i) => i.category_id === s.category_id && i.available)
              return (
                <div key={s.id} className="mt-5">
                  <p className="text-[13px] font-medium text-foreground">
                    {s.label} <span className="font-normal text-muted-foreground">· choose {s.qty}</span>
                  </p>
                  {options.length === 0 && (
                    <p className="mt-1.5 text-[12.5px] text-warning">Nothing available here right now.</p>
                  )}
                  {Array.from({ length: s.qty }).map((_, i) => {
                    const key = `${s.id}#${i}`
                    const pick = picks[key]
                    const pickVariants = pick?.itemId ? (variantsByItem.get(pick.itemId) ?? []) : []
                    return (
                      <div key={key} className="mt-2">
                        {s.qty > 1 && <p className="mb-1 text-[11.5px] text-muted-foreground">Pick {i + 1}</p>}
                        <div className="grid gap-1.5">
                          {options.map((o) => {
                            const on = pick?.itemId === o.id
                            return (
                              <button
                                key={o.id}
                                onClick={() => setPicks((p) => ({ ...p, [key]: { itemId: o.id, variantId: null } }))}
                                className={`flex min-h-11 items-center justify-between gap-2 rounded-[var(--radius)] border px-3 text-left text-[13.5px] ${
                                  on ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-foreground'
                                }`}
                              >
                                <span className="flex min-w-0 items-center gap-1.5">
                                  {o.is_veg != null && <VegDot isVeg={o.is_veg} />}
                                  <span className="truncate">{o.name}</span>
                                </span>
                                <span className="shrink-0 text-[12px] text-muted-foreground">₹{o.price}</span>
                              </button>
                            )
                          })}
                        </div>
                        {pickVariants.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {pickVariants.map((v) => {
                              const on = pick?.variantId === v.id
                              return (
                                <button
                                  key={v.id}
                                  onClick={() => setPicks((p) => ({ ...p, [key]: { itemId: p[key]?.itemId ?? '', variantId: v.id } }))}
                                  className={`min-h-9 rounded-full border px-3 text-[12.5px] font-medium ${
                                    on ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-muted-foreground'
                                  }`}
                                >
                                  {v.name}
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}

            {complete && saving > 0 && (
              <p className="mt-5 rounded-[var(--radius)] bg-success-subtle px-3 py-2 text-[12.5px] font-medium text-success">
                ₹{parts} if bought separately — you save ₹{saving}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 border-t border-border p-4">
          <div className="flex items-center gap-1 rounded-full border border-border-strong px-1">
            <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease" className="grid h-9 w-9 place-items-center text-muted-foreground">
              <Minus size={15} />
            </button>
            <span className="w-5 text-center text-[14px] font-medium text-foreground">{qty}</span>
            <button onClick={() => setQty((q) => q + 1)} aria-label="Increase" className="grid h-9 w-9 place-items-center text-muted-foreground">
              <Plus size={15} />
            </button>
          </div>
          <button
            onClick={() => onAdd({ selections, qty })}
            disabled={!complete}
            className="min-h-12 flex-1 rounded-[var(--radius)] bg-primary text-[14.5px] font-semibold text-primary-foreground disabled:opacity-50"
          >
            {complete ? `Add to cart · ₹${combo.price * qty}` : 'Choose your options'}
          </button>
        </div>
      </div>
    </div>
  )
}
