// "Today's Offer" — a per-item day-of-week discounted price (see
// supabase/migrations/0154_todays_offer_pricing.sql). Both fields null means
// no offer configured; this is the one place that predicate is evaluated, so
// every cart/display value that currently reads `item.price` directly can
// switch to effectivePrice() instead of re-deriving the check itself.
//
// todayWeekday must come from businessWeekday() (lib/datetime.ts) — 0=Sunday
// .. 6=Saturday, matching Postgres's own extract(dow from ...) convention
// exactly, so this never disagrees with what place_order/staff_place_order
// enforce server-side. This module never computes "today" itself: the caller
// owns the café's timezone.
export type OfferableItem = {
  price: number
  offer_price: number | null
  offer_days: number[] | null
}

export function isOfferActiveToday(item: OfferableItem, todayWeekday: number): boolean {
  return item.offer_price !== null && item.offer_days !== null && item.offer_days.includes(todayWeekday)
}

export function effectivePrice(item: OfferableItem, todayWeekday: number): number {
  return isOfferActiveToday(item, todayWeekday) ? (item.offer_price as number) : item.price
}
