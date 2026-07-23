'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Minus, Plus, UtensilsCrossed } from 'lucide-react'

export type QrItem = {
  id: string
  name: string
  description: string | null
  price: number
  image_url: string | null
  category_id: string | null
  is_veg: boolean | null
  is_bestseller: boolean
  is_upsell: boolean
  upsell_pitch: string | null
  available: boolean
  created_at: string
}

// One shared sizes string for every grid card. It must mirror the grid column
// counts in the menu exactly — get this wrong and phones download desktop-sized
// images, which is the single biggest data cost on a 300-item menu.
const GRID_SIZES =
  '(max-width: 379px) 100vw, (max-width: 767px) 50vw, (max-width: 1023px) 33vw, (max-width: 1279px) 25vw, 20vw'

export function VegDot({ isVeg, size = 12 }: { isVeg: boolean | null; size?: number }) {
  if (isVeg === null) return null
  return (
    <span
      aria-label={isVeg ? 'Vegetarian' : 'Non-vegetarian'}
      className={`grid shrink-0 place-items-center rounded-[3px] border ${
        isVeg ? 'border-success' : 'border-destructive'
      }`}
      style={{ width: size, height: size }}
    >
      <span
        className={`rounded-full ${isVeg ? 'bg-success' : 'bg-destructive'}`}
        style={{ width: size / 2.4, height: size / 2.4 }}
      />
    </span>
  )
}

// Never renders a broken image: a missing photo becomes a calm branded tile
// rather than a torn-page icon, and a slow one fades in over a skeleton.
export function FoodImage({
  src,
  alt,
  sizes,
  quality = 65,
  priority = false,
  className = '',
}: {
  src: string | null
  alt: string
  sizes: string
  quality?: 65 | 85
  priority?: boolean
  className?: string
}) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  if (!src || failed) {
    return (
      <div className={`grid h-full w-full place-items-center bg-surface-subtle ${className}`}>
        <UtensilsCrossed size={22} className="text-muted-foreground/40" strokeWidth={1.5} />
      </div>
    )
  }

  return (
    <>
      {!loaded && <div className="absolute inset-0 animate-pulse bg-surface-subtle" />}
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        quality={quality}
        priority={priority}
        loading={priority ? undefined : 'lazy'}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={`object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'} ${className}`}
      />
    </>
  )
}

function Badge({ label, tone }: { label: string; tone: 'gold' | 'green' }) {
  return (
    <span
      className={`rounded-full px-2 py-[3px] text-[10px] font-semibold leading-none tracking-wide backdrop-blur-sm ${
        tone === 'gold' ? 'bg-warning-subtle/95 text-warning' : 'bg-primary-subtle/95 text-primary'
      }`}
    >
      {label}
    </span>
  )
}

export function FoodCard({
  item,
  qty,
  isNew,
  priority,
  onOpen,
  onAdd,
  onDecrement,
}: {
  item: QrItem
  qty: number
  isNew: boolean
  priority: boolean
  onOpen: () => void
  onAdd: () => void
  onDecrement: () => void
}) {
  const soldOut = !item.available

  return (
    <article
      className={`group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-surface transition-shadow ${
        soldOut ? 'opacity-60' : 'hover:shadow-[var(--shadow-md)]'
      }`}
    >
      {/* The action anchors to the IMAGE box, not the card, so it can't drift
          as descriptions of different lengths change the card's height. */}
      <div className="relative aspect-[4/3] w-full bg-surface-subtle">
        <FoodImage src={item.image_url} alt={item.name} sizes={GRID_SIZES} priority={priority} />

        {/* Overlay tap target for details — a sibling rather than a wrapper,
            since nesting the Add button inside it would be invalid HTML. */}
        <button
          type="button"
          onClick={onOpen}
          disabled={soldOut}
          aria-label={`View ${item.name}`}
          className="absolute inset-0 disabled:cursor-default"
        />

        <span className="pointer-events-none absolute left-2 top-2 flex flex-wrap gap-1">
          {item.is_bestseller && !soldOut && <Badge label="Bestseller" tone="gold" />}
          {isNew && !item.is_bestseller && !soldOut && <Badge label="New" tone="green" />}
        </span>

        {soldOut && (
          <span className="absolute inset-x-0 bottom-0 bg-foreground/75 py-1.5 text-center text-[11px] font-medium text-background">
            Currently unavailable
          </span>
        )}

        {/* Overlaps the image's bottom edge — large thumb target without
            spending a whole content row on it. */}
        {!soldOut && (
          <div className="absolute -bottom-4 right-2.5 z-10">
            {qty === 0 ? (
              <button
                onClick={onAdd}
                aria-label={`Add ${item.name}`}
                className="h-9 min-w-[68px] rounded-full border border-primary bg-surface px-4 text-[13px] font-semibold uppercase tracking-wide text-primary shadow-[var(--shadow-md)] transition-transform active:scale-95"
              >
                Add
              </button>
            ) : (
              <div className="flex h-9 items-center gap-0.5 rounded-full border border-primary bg-primary px-1 shadow-[var(--shadow-md)]">
                <button
                  onClick={onDecrement}
                  aria-label={`Remove one ${item.name}`}
                  className="grid h-7 w-7 place-items-center rounded-full text-primary-foreground active:scale-90"
                >
                  <Minus size={14} strokeWidth={2.5} />
                </button>
                <span className="min-w-[16px] text-center text-[13px] font-semibold tabular-nums text-primary-foreground">
                  {qty}
                </span>
                <button
                  onClick={onAdd}
                  aria-label={`Add one ${item.name}`}
                  className="grid h-7 w-7 place-items-center rounded-full text-primary-foreground active:scale-90"
                >
                  <Plus size={14} strokeWidth={2.5} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* pt-6 clears the button overlapping from above. */}
      <div className="flex flex-1 flex-col px-3 pb-3 pt-6">
        <div className="flex items-start gap-1.5">
          <span className="mt-[3px]">
            <VegDot isVeg={item.is_veg} />
          </span>
          <h3 className="min-w-0 flex-1 text-[13.5px] font-semibold leading-tight text-foreground line-clamp-2">
            {item.name}
          </h3>
        </div>

        <p className="mt-1 text-[15px] font-semibold leading-none text-foreground">₹{item.price}</p>

        {item.description && (
          <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground line-clamp-2">
            {item.description}
          </p>
        )}
      </div>
    </article>
  )
}
