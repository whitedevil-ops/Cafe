// Shared QR-customer session cache, used by both the menu (gate) and My
// Orders. Only a convenience cache of the server-issued token, name, and
// phone — the database decides whether the token is still valid; a stale or
// forged value simply fails server-side (see customer_session_identity()).
//
// Scoped per CAFÉ, not per table — so a returning customer on the same
// device is recognized across different tables at the same café without
// re-entering their name/phone (see migration 0087). A different device
// never reuses this key; it starts its own independent scope.
export type CustomerSession = { token: string; name: string; phone: string }

const key = (cafeId: string) => `kp_customer_session_cafe_${cafeId}`

export function readCustomerSession(cafeId: string): CustomerSession | null {
  try {
    const raw = localStorage.getItem(key(cafeId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CustomerSession>
    if (!parsed.token || !parsed.phone) return null
    return { token: parsed.token, name: parsed.name ?? '', phone: parsed.phone }
  } catch {
    return null
  }
}

export function writeCustomerSession(cafeId: string, session: CustomerSession) {
  try {
    localStorage.setItem(key(cafeId), JSON.stringify(session))
  } catch {
    // A write failure (e.g. private-browsing storage limits) shouldn't break
    // ordering — the session still works for this page load, it just won't
    // persist across a reload.
  }
}

export function clearCustomerSession(cafeId: string) {
  try {
    localStorage.removeItem(key(cafeId))
  } catch {
    // Same as above — non-fatal.
  }
}

// One opaque id per browser, generated once and reused forever — this, not
// the phone number, is what customer_order_history scopes access by
// (migration 0087). It carries no personal data and proves nothing on its
// own; it just lets a device recognize "orders I placed" without letting a
// different device claim them by typing the same phone number.
const DEVICE_KEY = 'kp_device_id'

export function getOrCreateDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    // Storage unavailable — fall back to a per-load id. History/reorder
    // simply won't persist across reloads for this visit, same as any other
    // private-browsing limitation; ordering itself is unaffected.
    return crypto.randomUUID()
  }
}
