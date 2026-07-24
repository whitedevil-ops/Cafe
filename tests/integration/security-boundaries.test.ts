// Security regression tests — permanent guards for the critical trust
// boundaries, run live against production with ONLY the public anon key (the
// exact access a hostile visitor has). Added by the pre-launch security audit
// (2026-07-24). See SECURITY_AUDIT.md for the findings these lock in.
//
// The passing tests below assert boundaries that HOLD today. The `.skip`ped
// tests at the bottom assert the DESIRED state for the two open P1 findings
// (F-01, F-02) — remove `.skip` once the remediation migration is applied and
// they become live regression guards.
import { describe, it, expect } from 'vitest'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!URL || !KEY) throw new Error('NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY not set (need .env.local)')

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }

async function anonRead(table: string, cols = '*') {
  const res = await fetch(`${URL}/rest/v1/${table}?select=${cols}&limit=5`, { headers: H })
  const text = await res.text()
  let rows: unknown[] = []
  try { const j = JSON.parse(text); rows = Array.isArray(j) ? j : [] } catch { /* non-array error body */ }
  return { status: res.status, rows, text }
}

async function anonRpc(fn: string, body: Record<string, unknown>) {
  const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { ...H, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, text: await res.text() }
}

// Tables that must NEVER return rows to an anonymous caller.
const SENSITIVE = [
  'customers', 'orders', 'order_items', 'payments', 'refunds', 'expenses',
  'inventory_items', 'cafe_settings', 'audit_logs', 'platform_admins',
  'cafe_payment_secrets', 'loyalty_accounts', 'sms_logs', 'cash_shifts',
  'held_orders', 'notifications', 'table_sessions', 'payment_attempts',
  'gst_invoice_counters', 'operator_notes', 'password_reset_log',
  'customer_otp_challenges', 'customer_sessions', 'cafe_members', 'profiles',
]

describe('tenant isolation & RLS (live anon)', () => {
  it('anonymous caller reads no rows from any sensitive table', { timeout: 30000 }, async () => {
    for (const t of SENSITIVE) {
      const { status, rows } = await anonRead(t)
      // Either RLS returns an empty set (200 []) or the request is rejected.
      const safe = rows.length === 0 || status >= 400
      expect(safe, `${t} leaked ${rows.length} rows to anon (status ${status})`).toBe(true)
    }
  })

  it('encrypted per-café Razorpay secrets are never readable by anon', async () => {
    const { rows } = await anonRead('cafe_payment_secrets', 'cafe_id,key_secret_enc,webhook_secret_enc')
    expect(rows.length).toBe(0)
  })

  it('financial/staff RPCs reject the anon role', { timeout: 30000 }, async () => {
    const zero = '00000000-0000-0000-0000-000000000000'
    const cases: [string, Record<string, unknown>][] = [
      ['staff_place_order', { p_cafe_id: zero, p_items: [], p_settle: true }],
      ['record_payment', { p_order_id: zero, p_amount: 1, p_method: 'cash' }],
      ['record_session_payment', { p_session_id: zero, p_amount: 1, p_method: 'cash' }],
      ['outstanding_summary', { p_cafe_id: zero, p_from: '2026-01-01', p_to: '2027-01-01' }],
      ['refund_order', { p_order_id: zero, p_reason: 'x', p_method: 'cash' }],
      ['list_bills', { p_cafe_id: zero, p_from: '2026-01-01', p_to: '2027-01-01' }],
    ]
    for (const [fn, body] of cases) {
      const { status } = await anonRpc(fn, body)
      // 401/403 (permission denied) or 404 (not exposed) — never a 200 success.
      expect(status, `${fn} was reachable by anon (status ${status})`).toBeGreaterThanOrEqual(400)
    }
  })

  it('receipt tokens are unguessable — a random UUID resolves to nothing', async () => {
    const { text } = await anonRpc('get_receipt', { p_token: '11111111-2222-3333-4444-555555555555' })
    // get_receipt is anon-callable by design; a non-existent token must yield null.
    expect(text.trim() === 'null' || text.trim() === '').toBe(true)
  })
})

// Route protection — proves there is NO auth bypass: every protected page
// redirects an unauthenticated request to /login (audit upgrade #3).
describe('route protection (live, unauthenticated)', () => {
  // The DEPLOYED site — this asserts production route protection, so it must
  // not use a localhost APP_URL. Override with SECURITY_TEST_SITE if the
  // deployment lives elsewhere.
  const envSite = process.env.SECURITY_TEST_SITE
  const SITE = envSite && !envSite.includes('localhost') ? envSite : 'https://khaopiyo.ventron.in'

  it('protected routes 3xx-redirect to /login with no session', { timeout: 30000 }, async () => {
    const routes = ['/dashboard', '/dashboard/pos', '/dashboard/bills', '/dashboard/reports', '/dashboard/settings', '/platform-admin']
    for (const r of routes) {
      const res = await fetch(`${SITE}${r}`, { redirect: 'manual' })
      const loc = res.headers.get('location') ?? ''
      const redirected = res.status >= 300 && res.status < 400 && loc.includes('/login')
      expect(redirected, `${r} did not redirect to /login (status ${res.status}, location "${loc}")`).toBe(true)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────
// KNOWN OPEN P1 FINDINGS — remove `.skip` after applying remediation.
// These currently FAIL (the vulnerability is real); they are written now so
// that fixing F-01/F-02 flips them green and they guard against regression.
describe('open P1 findings (un-skip after remediation)', () => {
  it.skip('F-02: anon cannot read cafes.owner_id / email / phone / gstin', async () => {
    const { rows } = await anonRead('cafes', 'id,owner_id,email,phone,gstin')
    for (const r of rows as Record<string, unknown>[]) {
      expect(r.owner_id ?? null, 'owner_id exposed to anon').toBeNull()
      expect(r.email ?? null, 'email exposed to anon').toBeNull()
    }
  })

  // F-01 needs an AUTHENTICATED non-owner (e.g. cashier) JWT fixture, not the
  // anon key. Wire a test cashier login, then assert these are rejected:
  //   - PATCH /rest/v1/orders?id=eq.<id>  {payment_status:'paid'}  -> 403
  //   - POST  /rest/v1/payments  {amount:1,...}                    -> 403
  //   - DELETE /rest/v1/payments?id=eq.<id>                         -> 403
  it.todo('F-01: a non-owner member JWT cannot directly write orders/payments (needs auth fixture)')
})
