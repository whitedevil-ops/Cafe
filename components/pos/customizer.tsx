'use client'

import { useState } from 'react'
import type { PosItem } from '@/components/pos/product-card'
import type { PosVariant, PosAddon } from '@/app/dashboard/pos/page'

// Extracted from pos-client.tsx (POS redesign, presentation-only reorg) —
// mirrors the sibling ComboPicker/TableSelector pattern of one modal per
// file. No behavior change: same variant/add-on price-preview formula the
// cart's own confirmCustom() duplicates on add, same default-select-the-
// first-variant behavior.
export function Customizer({
  item,
  variants,
  addons,
  basePrice,
  isOfferActiveToday,
  onCancel,
  onAdd,
}: {
  item: PosItem & { category_id: string | null }
  variants: PosVariant[]
  addons: PosAddon[]
  /** item.price or its Today's Offer price, whichever applies today (see
   *  lib/offers.ts) — the caller owns the café's timezone. */
  basePrice: number
  isOfferActiveToday: boolean
  onCancel: () => void
  onAdd: (item: PosItem & { category_id: string | null }, variantId: string | null, addonIds: string[]) => void
}) {
  const [variantId, setVariantId] = useState<string | null>(variants[0]?.id ?? null)
  const [addonIds, setAddonIds] = useState<string[]>([])
  const v = variants.find((x) => x.id === variantId)
  const chosen = addons.filter((a) => addonIds.includes(a.id))
  const price = basePrice + (v?.price_delta ?? 0) + chosen.reduce((s, a) => s + a.price, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6">
      <div className="flex max-h-[90dvh] w-full max-w-md flex-col rounded-t-2xl bg-surface sm:max-h-[85dvh] sm:rounded-[var(--radius-lg)]">
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">{item.name}</h2>
            {isOfferActiveToday && (
              <span className="rounded-full bg-special-subtle px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-special">Today&apos;s Offer</span>
            )}
          </div>
          {variants.length > 0 && (
            <div className="mt-4">
              <p className="text-[13px] font-medium text-foreground">Choose one</p>
              <div className="mt-2 space-y-2">
                {variants.map((vr) => (
                  <label key={vr.id} className="flex min-h-11 items-center justify-between rounded-[var(--radius)] border border-border-strong px-3 text-sm text-foreground">
                    <span className="flex items-center gap-2">
                      <input type="radio" name="variant" checked={variantId === vr.id} onChange={() => setVariantId(vr.id)} />
                      {vr.name}
                    </span>
                    <span className="text-muted-foreground">₹{basePrice + vr.price_delta}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {addons.length > 0 && (
            <div className="mt-4">
              <p className="text-[13px] font-medium text-foreground">Add-ons</p>
              <div className="mt-2 space-y-2">
                {addons.map((a) => (
                  <label key={a.id} className="flex min-h-11 items-center justify-between rounded-[var(--radius)] border border-border-strong px-3 text-sm text-foreground">
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={addonIds.includes(a.id)}
                        onChange={(e) => setAddonIds((ids) => (e.target.checked ? [...ids, a.id] : ids.filter((x) => x !== a.id)))}
                      />
                      {a.name}
                    </span>
                    {/* Free extras (a pizza's toppings) read as "Free", not "+₹0". */}
                    <span className={a.price > 0 ? 'text-muted-foreground' : 'text-success'}>
                      {a.price > 0 ? `+₹${a.price}` : 'Free'}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex shrink-0 gap-2 border-t border-border p-6">
          <button onClick={onCancel} className="min-h-11 flex-1 rounded-[var(--radius)] border border-border-strong text-sm font-medium text-foreground">Cancel</button>
          <button onClick={() => onAdd(item, variantId, addonIds)} className="min-h-11 flex-1 rounded-[var(--radius)] bg-primary text-sm font-medium text-primary-foreground">
            Add · ₹{price}
          </button>
        </div>
      </div>
    </div>
  )
}
