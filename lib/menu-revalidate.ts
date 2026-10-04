// Browser half of menu-cache invalidation — see app/api/menu/revalidate/route.ts
// and the "two layers" note in lib/menu-cache.ts for why this exists.
//
// Call it AFTER a menu write has succeeded (and await it where the owner is
// likely to open the POS or QR menu straight away, e.g. on saving an item), so
// the next load rebuilds from the database instead of serving the old catalog.
//
// Deliberately never throws and never blocks a save on its own failure: if the
// call is lost (offline, signed-out tab) the 30s TTL in the caches still
// converges, exactly as it did before this existed. `keepalive` lets it finish
// even if the owner navigates away the instant the save completes, and the
// timeout stops an awaited call from holding a Save spinner open on a hung
// connection.
export async function invalidateMenuCaches(cafeId: string): Promise<void> {
  // AbortController + timer rather than AbortSignal.timeout: the latter is
  // missing from browsers older than ~2022, where it would throw before the
  // request was ever sent and silently skip the invalidation.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    await fetch('/api/menu/revalidate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cafe_id: cafeId }),
      keepalive: true,
      signal: controller.signal,
    })
  } catch {
    /* the TTL is the fallback */
  } finally {
    clearTimeout(timer)
  }
}
