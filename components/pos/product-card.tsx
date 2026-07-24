'use client'

import { Plus } from 'lucide-react'
import { FoodImage, VegDot, FoodBadge } from '@/components/ui/food-image'

export type PosItem = {
  id: string
  name: string
  price: number
  image_url: string | null
  is_veg: boolean | null
  is_bestseller: boolean
  hasOptions: boolean
  available: boolean
  created_at: string
}

// Mirrors the grid's column breakpoints exactly (2 → 3 → 4 columns beside the
// category rail) so phones never download a desktop-sized image.
const GRID_SIZES = '(max-width: 639px) 50vw, (max-width: 1279px) 33vw, 25vw'

export function ProductCard({
  item,
  qty,
  onAdd,
}: {
  item: PosItem
  qty: number
  onAdd: () => void
}) {
  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={!item.available}
      aria-label={item.available ? `Add ${item.name}` : `${item.name} is sold out`}
      className={`group relative flex flex-col overflow-hidden rounded-[var(--radius)] border border-border bg-surface text-left transition-all ${
        item.available ? 'hover:border-border-strong hover:shadow-[var(--shadow-md)] active:scale-[0.98]' : 'cursor-not-allowed opacity-60'
      }`}
    >
      <div className="relative aspect-[4/3] w-full bg-surface-subtle">
        <FoodImage src={item.image_url} alt={item.name} sizes={GRID_SIZES} />

        <span className="pointer-events-none absolute left-2 top-2 flex flex-wrap gap-1">
          {item.is_bestseller && item.available && <FoodBadge label="Bestseller" tone="gold" />}
          {item.hasOptions && item.available && <FoodBadge label="Customizable" tone="neutral" />}
        </span>

        {!item.available && (
          <span className="absolute inset-x-0 bottom-0 bg-foreground/75 py-1.5 text-center text-[11px] font-medium text-background">
            Sold out
          </span>
        )}

        {qty > 0 && (
          <span className="absolute right-2 top-2 grid h-6 min-w-6 place-items-center rounded-full bg-primary px-1 text-[12px] font-semibold text-primary-foreground shadow-[var(--shadow-sm)]">
            {qty}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-2.5">
        <div className="flex items-start gap-1.5">
          <span className="mt-[3px]"><VegDot isVeg={item.is_veg} /></span>
          <p className="min-w-0 flex-1 truncate text-[13px] font-medium leading-tight text-foreground">{item.name}</p>
        </div>
        <div className="mt-auto flex items-center justify-between pt-1">
          <span className="text-[14px] font-semibold text-foreground">
            ₹{item.price}
            {item.hasOptions && <span className="text-muted-foreground">+</span>}
          </span>
          <span
            aria-hidden
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-subtle text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground"
          >
            <Plus size={15} strokeWidth={2.5} />
          </span>
        </div>
      </div>
    </button>
  )
}
