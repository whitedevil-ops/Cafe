import { describe, it, expect } from 'vitest'
import { isOfferActiveToday, effectivePrice } from '@/lib/offers'

// 0=Sunday..6=Saturday, matching Postgres's extract(dow from ...) — see
// supabase/migrations/0154_todays_offer_pricing.sql and lib/datetime.ts's
// businessWeekday().
const TUESDAY = 2
const WEDNESDAY = 3

describe('isOfferActiveToday / effectivePrice', () => {
  it('is inactive when no offer is configured', () => {
    const item = { price: 69, offer_price: null, offer_days: null }
    expect(isOfferActiveToday(item, TUESDAY)).toBe(false)
    expect(effectivePrice(item, TUESDAY)).toBe(69)
  })

  it('is inactive when an offer is configured but today is not one of its days', () => {
    const item = { price: 69, offer_price: 49, offer_days: [TUESDAY] }
    expect(isOfferActiveToday(item, WEDNESDAY)).toBe(false)
    expect(effectivePrice(item, WEDNESDAY)).toBe(69)
  })

  it('is active when today is one of the offer\'s days', () => {
    const item = { price: 69, offer_price: 49, offer_days: [TUESDAY] }
    expect(isOfferActiveToday(item, TUESDAY)).toBe(true)
    expect(effectivePrice(item, TUESDAY)).toBe(49)
  })

  it('supports multiple offer days', () => {
    const item = { price: 149, offer_price: 99, offer_days: [TUESDAY, WEDNESDAY] }
    expect(isOfferActiveToday(item, TUESDAY)).toBe(true)
    expect(isOfferActiveToday(item, WEDNESDAY)).toBe(true)
    expect(isOfferActiveToday(item, 0)).toBe(false)
  })
})
