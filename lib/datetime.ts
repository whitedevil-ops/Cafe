// ============================================================================
// The one place KhaoPiyo converts a stored UTC instant into a café's local
// business time. Every screen must format dates through here.
//
// WHY THIS EXISTS: `new Date(iso).toLocaleString('en-IN', …)` looks correct but
// is not. The locale controls the FORMAT (day-first, month names); it does not
// set the timezone. Without an explicit `timeZone`, output follows whatever the
// runtime is set to — UTC on Vercel's servers, and the visitor's own zone in
// the browser. That made server-rendered bills print 5h30m early, and made the
// same order display differently depending on where it was rendered.
//
// ARCHITECTURE: timestamps stay `timestamptz` (UTC) in Postgres and are never
// rewritten. Conversion happens only at display time, and only via Intl with an
// explicit IANA zone — never by adding a fixed 5h30m, which would silently
// break for any café outside India and for any zone observing DST.
// ============================================================================

export const DEFAULT_TIMEZONE = 'Asia/Kolkata'

type Input = string | number | Date | null | undefined

function toDate(value: Input): Date | null {
  if (value === null || value === undefined) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

// ICU emits a narrow no-break space before am/pm in newer builds, and lowercases
// the day period under en-IN. Normalise both so bills read "4:35 PM" everywhere.
function tidy(s: string): string {
  return s
    .replace(/ | /g, ' ')
    .replace(/\b([ap])\.?\s?m\.?\b/gi, (m) => m.replace(/[.\s]/g, '').toUpperCase())
}

function format(value: Input, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  const d = toDate(value)
  if (!d) return '—'
  return tidy(new Intl.DateTimeFormat('en-IN', { timeZone, ...options }).format(d))
}

/** "23 Jul 2026, 4:35 PM" — bills, invoices, audit entries. */
export function formatDateTime(value: Input, timeZone: string = DEFAULT_TIMEZONE): string {
  return format(value, timeZone, {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

/** "23 Jul 2026" */
export function formatDate(value: Input, timeZone: string = DEFAULT_TIMEZONE): string {
  return format(value, timeZone, { day: '2-digit', month: 'short', year: 'numeric' })
}

/** "23 Jul" — compact lists where the year is obvious. */
export function formatDayMonth(value: Input, timeZone: string = DEFAULT_TIMEZONE): string {
  return format(value, timeZone, { day: '2-digit', month: 'short' })
}

/** "4:35 PM" — KDS tickets, notifications, held orders. */
export function formatTime(value: Input, timeZone: string = DEFAULT_TIMEZONE): string {
  return format(value, timeZone, { hour: 'numeric', minute: '2-digit', hour12: true })
}

// ── Business-day maths ──────────────────────────────────────────────────────

// How far the zone is from UTC at THIS instant. Derived by asking Intl to
// render the instant in the target zone and reading the fields back, so DST is
// handled by the platform's tz database rather than by us guessing.
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at)

  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  // hour can come back as 24 at midnight in some ICU builds.
  const asIfUTC = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour') % 24, n('minute'), n('second'))
  return asIfUTC - at.getTime()
}

/** The café-local calendar date of an instant, as "YYYY-MM-DD". Use this to
 *  group orders into business days — never `toISOString().slice(0,10)`, which
 *  buckets by UTC and drops late-evening IST orders into the next day. */
export function businessDayKey(value: Input, timeZone: string = DEFAULT_TIMEZONE): string {
  const d = toDate(value)
  if (!d) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

/** The exact UTC instant at which the café's business day began. */
export function businessDayStart(timeZone: string = DEFAULT_TIMEZONE, ref: Date = new Date()): Date {
  const ymd = businessDayKey(ref, timeZone)
  const midnightAsUTC = new Date(`${ymd}T00:00:00Z`)

  // Offset sampled at UTC-midnight can differ from the offset actually in force
  // at local midnight when a DST transition falls between them; one correction
  // pass resolves that. (No-op for Asia/Kolkata, which has no DST.)
  const first = zoneOffsetMs(midnightAsUTC, timeZone)
  let result = new Date(midnightAsUTC.getTime() - first)
  const second = zoneOffsetMs(result, timeZone)
  if (second !== first) result = new Date(midnightAsUTC.getTime() - second)
  return result
}

export function businessDayStartISO(timeZone: string = DEFAULT_TIMEZONE, ref: Date = new Date()): string {
  return businessDayStart(timeZone, ref).toISOString()
}

/** Start of the business day N days back (0 = today, 1 = yesterday). */
export function businessDaysAgoStartISO(
  days: number,
  timeZone: string = DEFAULT_TIMEZONE,
  ref: Date = new Date(),
): string {
  const todayStart = businessDayStart(timeZone, ref)
  // Step back in whole days from local noon, so a DST shift can't land us on
  // the wrong calendar date, then re-resolve that date's true midnight.
  const noonish = new Date(todayStart.getTime() + 12 * 3600_000 - days * 86400_000)
  return businessDayStartISO(timeZone, noonish)
}

/** True when the instant falls on the café's current business day. */
export function isToday(value: Input, timeZone: string = DEFAULT_TIMEZONE): boolean {
  const d = toDate(value)
  if (!d) return false
  return businessDayKey(d, timeZone) === businessDayKey(new Date(), timeZone)
}

/** "Today" / "Yesterday" / "23 Jul 2026" — order-history grouping headers. */
export function relativeDayLabel(value: Input, timeZone: string = DEFAULT_TIMEZONE): string {
  const d = toDate(value)
  if (!d) return '—'
  const key = businessDayKey(d, timeZone)
  const now = new Date()
  if (key === businessDayKey(now, timeZone)) return 'Today'
  if (key === businessDayKey(new Date(now.getTime() - 86400_000), timeZone)) return 'Yesterday'
  return formatDate(d, timeZone)
}
