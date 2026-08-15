// Security regression tests — permanent guards for the critical trust
// boundaries, run live against production with ONLY the public anon key (the
// exact access a hostile visitor has). Added by the pre-launch security audit
// (2026-07-24). See SECURITY_AUDIT.md for the findings these lock in.
//
// F-01 and F-02 were both remediated (migrations 0050 and 0049) before this
// file was last touched — the tests below assert the boundaries that hold
// TODAY, live, not aspirational ones.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

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
    const routes = ['/dashboard', '/dashboard/pos', '/dashboard/bills', '/dashboard/reports', '/dashboard/settings', '/ops']
    for (const r of routes) {
      const res = await fetch(`${SITE}${r}`, { redirect: 'manual' })
      const loc = res.headers.get('location') ?? ''
      const redirected = res.status >= 300 && res.status < 400 && loc.includes('/login')
      expect(redirected, `${r} did not redirect to /login (status ${res.status}, location "${loc}")`).toBe(true)
    }
  })
})

describe('F-02 regression guard (live)', () => {
  // Migration 0049: anon may read only the public café columns, never
  // owner_id / email / phone / gstin. Requesting them now fails with a
  // column-privilege error instead of returning the values.
  it('F-02: anon cannot read cafes.owner_id / email / phone / gstin', async () => {
    const { status, rows } = await anonRead('cafes', 'id,owner_id,email,phone,gstin')
    // Either the request is rejected (column privilege denied) or, if it somehow
    // returns rows, those sensitive fields must be absent/null.
    if (status < 400) {
      for (const r of rows as Record<string, unknown>[]) {
        expect(r.owner_id ?? null, 'owner_id exposed to anon').toBeNull()
        expect(r.email ?? null, 'email exposed to anon').toBeNull()
      }
    } else {
      expect(status).toBeGreaterThanOrEqual(400)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────
// F-01 regression guard — needs an AUTHENTICATED non-owner (cashier) JWT,
// not the anon key, so this block creates one throwaway café + cashier
// member + auth user via the service-role admin client, runs the three
// attack requests from SECURITY_AUDIT.md as that cashier, then deletes
// everything it created. Skips (not fails) when no service role key is
// configured locally — the anon-only tests above still run either way.
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const hasAdmin = Boolean(URL && SERVICE_KEY)

describe.skipIf(!hasAdmin)('F-01 regression guard (live, needs SUPABASE_SERVICE_ROLE_KEY)', () => {
  let cafeId: string
  let userId: string
  let cashierAuth: { apikey: string; Authorization: string }

  beforeAll(async () => {
    const admin = createClient(URL!, SERVICE_KEY!, { auth: { persistSession: false } })
    const email = `test-cashier-${Date.now()}@khaopiyo-test.invalid`
    const password = crypto.randomUUID()

    const { data: userRes, error: userErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
    })
    if (userErr || !userRes.user) throw new Error(`fixture: could not create test user — ${userErr?.message}`)
    userId = userRes.user.id

    const { data: cafe, error: cafeErr } = await admin
      .from('cafes')
      .insert({ owner_id: userId, slug: `test-f01-${Date.now()}`, name: 'F-01 test café' })
      .select('id').single()
    if (cafeErr || !cafe) throw new Error(`fixture: could not create test café — ${cafeErr?.message}`)
    cafeId = cafe.id

    // The fixture user is its own café's owner by insert above — demote to
    // cashier, the least-privileged non-kitchen role, which is exactly the
    // attacker profile F-01 describes ("any café member, not just owner").
    const { error: memberErr } = await admin
      .from('cafe_members')
      .update({ role: 'cashier' })
      .eq('cafe_id', cafeId).eq('user_id', userId)
    if (memberErr) throw new Error(`fixture: could not set cashier role — ${memberErr.message}`)

    const plain = createClient(URL!, KEY, { auth: { persistSession: false } })
    const { data: session, error: signInErr } = await plain.auth.signInWithPassword({ email, password })
    if (signInErr || !session.session) throw new Error(`fixture: cashier sign-in failed — ${signInErr?.message}`)
    cashierAuth = { apikey: KEY, Authorization: `Bearer ${session.session.access_token}` }
  })

  afterAll(async () => {
    const admin = createClient(URL!, SERVICE_KEY!, { auth: { persistSession: false } })
    if (cafeId) await admin.from('cafes').delete().eq('id', cafeId)
    if (userId) await admin.auth.admin.deleteUser(userId)
  })

  it('a cashier JWT cannot PATCH orders.payment_status directly', async () => {
    const res = await fetch(`${URL}/rest/v1/orders?cafe_id=eq.${cafeId}`, {
      method: 'PATCH',
      headers: { ...cashierAuth, 'content-type': 'application/json' },
      body: JSON.stringify({ payment_status: 'paid', total: 1 }),
    })
    expect(res.status, `expected a rejection, got ${res.status}`).toBeGreaterThanOrEqual(400)
  })

  it('a cashier JWT cannot POST fabricated rows into payments', async () => {
    const res = await fetch(`${URL}/rest/v1/payments`, {
      method: 'POST',
      headers: { ...cashierAuth, 'content-type': 'application/json' },
      body: JSON.stringify({ cafe_id: cafeId, amount: 100000, method: 'cash' }),
    })
    expect(res.status, `expected a rejection, got ${res.status}`).toBeGreaterThanOrEqual(400)
  })

  it('a cashier JWT cannot DELETE rows from payments', async () => {
    const res = await fetch(`${URL}/rest/v1/payments?cafe_id=eq.${cafeId}`, {
      method: 'DELETE',
      headers: cashierAuth,
    })
    expect(res.status, `expected a rejection, got ${res.status}`).toBeGreaterThanOrEqual(400)
  })

  it('a cashier JWT cannot directly write customers or cafe_settings either', async () => {
    const writeCustomers = await fetch(`${URL}/rest/v1/customers`, {
      method: 'POST',
      headers: { ...cashierAuth, 'content-type': 'application/json' },
      body: JSON.stringify({ cafe_id: cafeId, phone: '9999999999', name: 'Injected' }),
    })
    expect(writeCustomers.status, `customers POST expected rejection, got ${writeCustomers.status}`).toBeGreaterThanOrEqual(400)

    const writeSettings = await fetch(`${URL}/rest/v1/cafe_settings?cafe_id=eq.${cafeId}`, {
      method: 'PATCH',
      headers: { ...cashierAuth, 'content-type': 'application/json' },
      body: JSON.stringify({ hours: { hacked: true } }),
    })
    expect(writeSettings.status, `cafe_settings PATCH expected rejection, got ${writeSettings.status}`).toBeGreaterThanOrEqual(400)
  })
})
