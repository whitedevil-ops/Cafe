'use client'

import { useEffect, useState } from 'react'
import { Minus, Plus, X } from 'lucide-react'
import { type QrItem } from './food-card'
import { FoodImage, VegDot } from '@/components/ui/food-image'

export type QrVariant = { id: string; menu_item_id: string; name: string; price_delta: number }
export type QrAddon = { id: string; menu_item_id: string; name: string; price: number }

export function ItemSheet({
  item,
  variants,
  addons,
  onClose,
  onAdd,
}: {
  item: QrItem
  variants: QrVariant[]
  addons: QrAddon[]
  onClose: () => void
  onAdd: (args: { variantId: string | null; addonIds: string[]; note: string; qty: number }) => void
}) {
  const [variantId, setVariantId] = useState<string | null>(variants[0]?.id ?? null)
  const [addonIds, setAddonIds] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [qty, setQty] = useState(1)

  // The sheet covers the menu; letting the list scroll underneath it is the
  // classic mobile bug where dismissing returns you somewhere unexpected.
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

  const variant = variants.find((v) => v.id === variantId) ?? null
  const chosen = addons.filter((a) => addonIds.includes(a.id))
  const unit = item.price + (variant?.price_delta ?? 0) + chosen.reduce((s, a) => s + a.price, 0)
  const total = unit * qty

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
        aria-label={item.name}
      >
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="relative aspect-[16/10] w-full bg-surface-subtle">
            <FoodImage
              src={item.image_url}
              alt={item.name}
              sizes="(max-width: 640px) 100vw, 448px"
              quality={85}
              priority
            />
            <button
              onClick={onClose}
              aria-label="Close"
              className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-surface/90 text-foreground shadow-[var(--shadow-md)] backdrop-blur-sm"
            >
              <X size={18} />
            </button>
          </div>

          <div className="p-5">
            <div className="flex items-start gap-2">
              <span className="mt-1.5">
                <VegDot isVeg={item.is_veg} size={14} />
              </span>
              <h2 className="min-w-0 flex-1 text-[19px] font-semibold leading-tight text-foreground">
                {item.name}
              </h2>
            </div>

            {item.description && (
              <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">{item.description}</p>
            )}

            <p className="mt-3 text-[18px] font-semibold text-foreground">₹{item.price}</p>

            {variants.length > 0 && (
              <section className="mt-6">
                <h3 className="text-[13px] font-semibold text-foreground">
                  Choose one <span className="font-normal text-muted-foreground">· required</span>
                </h3>
                <div className="mt-2.5 space-y-2">
                  {variants.map((v) => (
                    <label
                      key={v.id}
                      className={`flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-[var(--radius)] border px-3.5 text-[14px] transition-colors ${
                        variantId === v.id ? 'border-primary bg-primary-subtle' : 'border-border-strong'
                      }`}
                    >
                      <span className="flex items-center gap-2.5 text-foreground">
                        <input
                          type="radio"
                          name="variant"
                          checked={variantId === v.id}
                          onChange={() => setVariantId(v.id)}
                          className="accent-[var(--primary)]"
                        />
                        {v.name}
                      </span>
                      <span className="shrink-0 font-medium text-muted-foreground">
                        ₹{item.price + v.price_delta}
                      </span>
                    </label>
                  ))}
                </div>
              </section>
            )}

            {addons.length > 0 && (
              <section className="mt-6">
                <h3 className="text-[13px] font-semibold text-foreground">
                  Add-ons <span className="font-normal text-muted-foreground">· optional</span>
                </h3>
                <div className="mt-2.5 space-y-2">
                  {addons.map((a) => (
                    <label
                      key={a.id}
                      className={`flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-[var(--radius)] border px-3.5 text-[14px] transition-colors ${
                        addonIds.includes(a.id) ? 'border-primary bg-primary-subtle' : 'border-border-strong'
                      }`}
                    >
                      <span className="flex items-center gap-2.5 text-foreground">
                        <input
                          type="checkbox"
                          checked={addonIds.includes(a.id)}
                          onChange={(e) =>
                            setAddonIds((ids) => (e.target.checked ? [...ids, a.id] : ids.filter((x) => x !== a.id)))
                          }
                          className="accent-[var(--primary)]"
                        />
                        {a.name}
                      </span>
                      <span className="shrink-0 font-medium text-muted-foreground">+₹{a.price}</span>
                    </label>
                  ))}
                </div>
              </section>
            )}

            <section className="mt-6">
              <h3 className="text-[13px] font-semibold text-foreground">
                Special instructions <span className="font-normal text-muted-foreground">· optional</span>
              </h3>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 140))}
                rows={2}
                placeholder="e.g. less spicy, no onions"
                className="mt-2 w-full resize-none rounded-[var(--radius)] border border-border-strong bg-surface px-3.5 py-2.5 text-[14px] text-foreground placeholder:text-muted-foreground"
              />
              <p className="mt-1 text-right text-[11px] text-muted-foreground">{note.length}/140</p>
            </section>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-border bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="flex h-12 shrink-0 items-center gap-1 rounded-[var(--radius)] border border-border-strong px-1">
            <button
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              disabled={qty === 1}
              aria-label="Decrease quantity"
              className="grid h-10 w-10 place-items-center rounded-[var(--radius-sm)] text-foreground disabled:opacity-30"
            >
              <Minus size={16} />
            </button>
            <span className="min-w-[24px] text-center text-[15px] font-semibold tabular-nums text-foreground">
              {qty}
            </span>
            <button
              onClick={() => setQty((q) => q + 1)}
              aria-label="Increase quantity"
              className="grid h-10 w-10 place-items-center rounded-[var(--radius-sm)] text-foreground"
            >
              <Plus size={16} />
            </button>
          </div>

          <button
            onClick={() => onAdd({ variantId, addonIds, note: note.trim(), qty })}
            className="h-12 flex-1 rounded-[var(--radius)] bg-primary text-[15px] font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
          >
            Add to cart · ₹{total}
          </button>
        </div>
      </div>
    </div>
  )
}
