import { describe, it, expect } from 'vitest'
import {
  formatDateTime, formatDate, formatTime, businessDayKey,
  businessDayStartISO, businessDaysAgoStartISO,
} from '@/lib/datetime'

const TZ = 'Asia/Kolkata'

describe('formatDateTime', () => {
  it('renders a UTC instant in IST, not the runtime timezone', () => {
    expect(formatDateTime('2026-07-23T11:05:00Z', TZ)).toBe('23 Jul 2026, 4:35 PM')
  })

  it('returns an em dash for null/garbage input instead of throwing', () => {
    expect(formatDateTime(null, TZ)).toBe('—')
    expect(formatDateTime('not-a-date', TZ)).toBe('—')
  })

  it('supports other timezones (per-café architecture, not a hardcoded IST)', () => {
    expect(formatDateTime('2026-07-23T11:05:00Z', 'America/New_York')).toBe('23 Jul 2026, 7:05 AM')
  })
})

describe('the 23:30–01:00 IST business-day boundary', () => {
  // IST midnight == 18:30Z the previous day. These four instants are the
  // exact case that broke before lib/datetime.ts existed: naive UTC-date
  // bucketing puts 23:59 IST on the wrong calendar day.
  const lateEve = '2026-07-23T17:59:00Z' // 23:29 IST on 23 Jul
  const oneMinTo = '2026-07-23T18:29:00Z' // 23:59 IST on 23 Jul
  const justPast = '2026-07-23T18:31:00Z' // 00:01 IST on 24 Jul
  const oneAM = '2026-07-23T19:30:00Z' // 01:00 IST on 24 Jul

  it('keeps 23:29 and 23:59 IST on the same day', () => {
    expect(businessDayKey(lateEve, TZ)).toBe('2026-07-23')
    expect(businessDayKey(oneMinTo, TZ)).toBe('2026-07-23')
  })

  it('rolls 00:01 and 01:00 IST onto the next day', () => {
    expect(businessDayKey(justPast, TZ)).toBe('2026-07-24')
    expect(businessDayKey(oneAM, TZ)).toBe('2026-07-24')
  })

  it('displays the clock time correctly across the boundary', () => {
    expect(formatTime(oneMinTo, TZ)).toBe('11:59 PM')
    expect(formatTime(justPast, TZ)).toBe('12:01 AM')
    expect(formatDate(justPast, TZ)).toBe('24 Jul 2026')
  })

  it('places an order at 23:59 IST inside the correct business-day window', () => {
    const start = businessDayStartISO(TZ, new Date(oneMinTo))
    expect(start).toBe('2026-07-22T18:30:00.000Z')
    expect(new Date(oneMinTo) >= new Date(start)).toBe(true)
  })

  it('opens the next window at exactly 00:01 IST', () => {
    expect(businessDayStartISO(TZ, new Date(justPast))).toBe('2026-07-23T18:30:00.000Z')
  })

  it('computes yesterday relative to a late-night instant', () => {
    expect(businessDaysAgoStartISO(1, TZ, new Date(justPast))).toBe('2026-07-22T18:30:00.000Z')
  })
})

describe('DST-observing zones (per-café timezone is not assumed IST-shaped)', () => {
  it('starts the London business day at 23:00Z during BST', () => {
    expect(businessDayStartISO('Europe/London', new Date('2026-07-23T12:00:00Z')))
      .toBe('2026-07-22T23:00:00.000Z')
  })

  it('starts the London business day at 00:00Z during GMT', () => {
    expect(businessDayStartISO('Europe/London', new Date('2026-01-15T12:00:00Z')))
      .toBe('2026-01-15T00:00:00.000Z')
  })
})
