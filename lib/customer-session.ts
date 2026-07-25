// Shared QR-customer session cache, used by both the menu (gate) and My
// Orders. Only a convenience cache of the server-issued token, name, and
// phone — the database decides whether the token is still valid; a stale or
// forged value simply fails server-side (see customer_session_identity()).
export type CustomerSession = { token: string; name: string; phone: string }

const key = (tableToken: string) => `kp_customer_session_${tableToken}`

export function readCustomerSession(tableToken: string): CustomerSession | null {
  try {
    const raw = localStorage.getItem(key(tableToken))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CustomerSession>
    if (!parsed.token || !parsed.phone) return null
    return { token: parsed.token, name: parsed.name ?? '', phone: parsed.phone }
  } catch {
    return null
  }
}

export function writeCustomerSession(tableToken: string, session: CustomerSession) {
  localStorage.setItem(key(tableToken), JSON.stringify(session))
}

export function clearCustomerSession(tableToken: string) {
  localStorage.removeItem(key(tableToken))
}
