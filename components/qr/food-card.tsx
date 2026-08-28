'use client'

import { Minus, Plus } from 'lucide-react'
import { FoodImage, VegDot, FoodBadge } from '@/components/ui/food-image'

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
  /** Today's Offer — see lib/offers.ts for the "is it active today" check. */
  offer_price: number | null
  offer_days: number[] | null
}

// One shared sizes string for every grid card. It must mirror the grid column
// counts in the menu exactly — get this wrong and phones download desktop-sized
// images, which is the single biggest data cost on a 300-item menu.
const GRID_SIZES =
  '(max-width: 379px) 100vw, (max-width: 767px) 50vw, (max-width: 1023px) 33vw, (max-width: 1279px) 25vw, 20vw'

export function FoodCard({
  item,
  qty,
  isNew,
  isOfferActiveToday,
  priority,
  onOpen,
  onAdd,
  onDecrement,
}: {
  item: QrItem
  qty: number
  isNew: boolean
  /** Precomputed by the caller (which owns the café's timezone) — see
   *  lib/offers.ts. */
  isOfferActiveToday: boolean
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
      // content-visibility: auto tells the browser to skip rendering (and
      // fetching images for) cards far outside the viewport — the native,
      // zero-JS equivalent of list virtualization. contain-intrinsic-size
      // reserves roughly a card's real height so the scrollbar/scroll
      // position don't jump once an off-screen card is skipped. Priority
      // cards (first 4, above the fold) are excluded since they should
      // never be deferred. Unsupported browsers just render normally.
      style={priority ? undefined : { contentVisibility: 'auto', containIntrinsicSize: '0 260px' }}
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
          {isOfferActiveToday && !soldOut && <FoodBadge label="Today's Offer" tone="special" />}
          {!isOfferActiveToday && item.is_bestseller && !soldOut && <FoodBadge label="Bestseller" tone="gold" />}
          {!isOfferActiveToday && isNew && !item.is_bestseller && !soldOut && <FoodBadge label="New" tone="green" />}
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
                className="h-10 min-w-[68px] rounded-full border border-primary bg-surface px-4 text-[13px] font-semibold uppercase tracking-wide text-primary shadow-[var(--shadow-md)] transition-transform active:scale-95"
              >
                Add
              </button>
            ) : (
              <div className="flex h-10 items-center gap-0.5 rounded-full border border-primary bg-primary px-1 shadow-[var(--shadow-md)]">
                {/* 32px, up from 28 — the most-tapped control on the highest-
                    traffic page in the app was under both the 44px Apple and
                    48px Android touch-target guidelines. Not raised all the
                    way to 44 here: the two buttons sit close together either
                    side of the qty number, and growing them further without
                    live device testing (unavailable this session) risks
                    making an accidental hit on the wrong one more likely,
                    not less. */}
                <button
                  onClick={onDecrement}
                  aria-label={`Remove one ${item.name}`}
                  className="grid h-8 w-8 place-items-center rounded-full text-primary-foreground active:scale-90"
                >
                  <Minus size={14} strokeWidth={2.5} />
                </button>
                <span className="min-w-[16px] text-center text-[13px] font-semibold tabular-nums text-primary-foreground">
                  {qty}
                </span>
                <button
                  onClick={onAdd}
                  aria-label={`Add one ${item.name}`}
                  className="grid h-8 w-8 place-items-center rounded-full text-primary-foreground active:scale-90"
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

        {isOfferActiveToday ? (
          <p className="mt-1 flex items-baseline gap-1.5 leading-none">
            <span className="text-[15px] font-semibold text-special">₹{item.offer_price}</span>
            <span className="text-[12px] text-muted-foreground line-through">₹{item.price}</span>
          </p>
        ) : (
          <p className="mt-1 text-[15px] font-semibold leading-none text-foreground">₹{item.price}</p>
        )}

        {item.description && (
          <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground line-clamp-2">
            {item.description}
          </p>
        )}
      </div>
    </article>
  )
}
