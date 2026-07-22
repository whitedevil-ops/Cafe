'use client'

import { Plus } from 'lucide-react'

export type PosItem = {
  id: string
  name: string
  price: number
  image_url: string | null
  is_veg: boolean | null
  is_bestseller: boolean
  hasOptions: boolean
}

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
    <div className="group relative flex flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface shadow-[var(--shadow-sm)] transition-shadow hover:shadow-[var(--shadow-md)]">
      <div className="relative aspect-[4/3] w-full bg-surface-subtle">
        {item.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.image_url} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center text-[11px] text-muted-foreground">No photo</div>
        )}
        {item.is_bestseller && (
          <span className="absolute left-2 top-2 rounded-full bg-warning-subtle px-2 py-0.5 text-[10px] font-medium text-warning">
            Bestseller
          </span>
        )}
        {qty > 0 && (
          <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-primary text-[12px] font-semibold text-primary-foreground">
            {qty}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-3">
        <div className="flex items-start gap-1.5">
          {item.is_veg !== null && (
            <span
              className={`mt-1 grid h-3 w-3 shrink-0 place-items-center border ${
                item.is_veg ? 'border-success' : 'border-destructive'
              }`}
              aria-label={item.is_veg ? 'Vegetarian' : 'Non-vegetarian'}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${item.is_veg ? 'bg-success' : 'bg-destructive'}`} />
            </span>
          )}
          <p className="min-w-0 flex-1 truncate text-[13.5px] font-medium leading-tight text-foreground">{item.name}</p>
        </div>
        <div className="mt-auto flex items-center justify-between pt-3">
          <span className="text-[14px] font-semibold text-foreground">
            ₹{item.price}
            {item.hasOptions && <span className="text-muted-foreground">+</span>}
          </span>
          <button
            onClick={onAdd}
            aria-label={`Add ${item.name}`}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-subtle text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
          >
            <Plus size={16} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  )
}
