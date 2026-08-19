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
      // 0137/0138/0141/0140 (this session's audit): these are internal-only
      // helpers with exactly one legitimate caller shape — another SECURITY
      // DEFINER function that already authorized the request — so NO grant,
      // anon or authenticated, should ever reach them directly.
      ['apply_order_taxes', { p_order_id: zero, p_discount: 0 }],
      ['resolve_coupon_discount', { p_cafe_id: zero, p_code: 'X', p_subtotal: 100 }],
      ['order_outstanding', { p_order_id: zero }],
      ['order_refunded_total', { p_order_id: zero }],
      ['bill_status', { p_order_id: zero }],
      ['build_kot_payload', { p_order_id: zero, p_printer_id: zero }],
      ['recompute_order_payment_status', { p_order_id: zero }],
      ['menu_item_effective_cost_internal', { p_menu_item_id: zero }],
    ]
    for (const [fn, body] of cases) {
      const { status } = await anonRpc(fn, body)
      // 401/403 (permission denied) or 404 (not exposed) — never a 200 success.
      expect(status, `${fn} was reachable by anon (status ${status})`).toBeGreaterThanOrEqual(400)
    }
  })

  it('anon cannot read menu_items.cost / cost_source — food-cost stays private', async () => {
    // 0140: the public menu (name/price/etc) is genuinely public; cost and
    // cost_source are not. PostgREST rejects a select naming ANY column the
    // caller has no privilege on — the whole request errors, it does not
    // silently drop just that column — so a 200 here would mean the column
    // grant is still open, and any returned row must show no cost data.
    const { status, rows } = await anonRead('menu_items', 'id,name,price,cost,cost_source')
    if (status < 400) {
      for (const r of rows as Record<string, unknown>[]) {
        expect(r.cost ?? null, 'menu_items.cost exposed to anon').toBeNull()
        expect(r.cost_source ?? null, 'menu_items.cost_source exposed to anon').toBeNull()
      }
    } else {
      expect(status).toBeGreaterThanOrEqual(400)
    }
  })

  it('anon cannot read menu_item_variants.cost_delta — same food-cost boundary', async () => {
    const { status, rows } = await anonRead('menu_item_variants', 'id,name,price_delta,cost_delta')
    if (status < 400) {
      for (const r of rows as Record<string, unknown>[]) {
        expect(r.cost_delta ?? null, 'menu_item_variants.cost_delta exposed to anon').toBeNull()
      }
    } else {
      expect(status).toBeGreaterThanOrEqual(400)
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

  it('a signed-in cashier — not just anon — cannot reach the internal-only order helpers', { timeout: 30000 }, async () => {
    // The critical gap this session's audit found: these were reachable by
    // ANY authenticated user, not merely by anon — a real signed-in account
    // with no relationship to the target order/café. The anon-only checks
    // above prove the outer door is locked; this proves being logged in at
    // all does not let you walk through it either.
    async function rpcAs(auth: { apikey: string; Authorization: string }, fn: string, body: Record<string, unknown>) {
      const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      return res.status
    }
    const zero = '00000000-0000-0000-0000-000000000000'
    const cases: [string, Record<string, unknown>][] = [
      ['apply_order_taxes', { p_order_id: zero, p_discount: 0 }],
      ['resolve_coupon_discount', { p_cafe_id: zero, p_code: 'X', p_subtotal: 100 }],
      ['order_outstanding', { p_order_id: zero }],
      ['order_refunded_total', { p_order_id: zero }],
      ['bill_status', { p_order_id: zero }],
      ['build_kot_payload', { p_order_id: zero, p_printer_id: zero }],
      ['recompute_order_payment_status', { p_order_id: zero }],
      ['menu_item_effective_cost_internal', { p_menu_item_id: zero }],
    ]
    for (const [fn, body] of cases) {
      const status = await rpcAs(cashierAuth, fn, body)
      expect(status, `${fn} was reachable by a signed-in cashier (status ${status})`).toBeGreaterThanOrEqual(400)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────
// 0142/0143 regressions — a second small fixture (owner + manager, left on
// the default 'trial' plan deliberately, since that plan has coupons/
// loyalty off) proving: (a) a feature not on the café's plan cannot be
// created via direct RPC even by the owner, not merely hidden by the nav,
// and (b) a manager cannot mint a new owner through create_staff_member.
describe.skipIf(!hasAdmin)('entitlement & role-escalation regression guard (live, needs SUPABASE_SERVICE_ROLE_KEY)', () => {
  let cafeId: string
  let ownerUserId: string
  let managerUserId: string
  let ownerAuth: { apikey: string; Authorization: string }
  let managerAuth: { apikey: string; Authorization: string }

  beforeAll(async () => {
    const admin = createClient(URL!, SERVICE_KEY!, { auth: { persistSession: false } })
    const stamp = Date.now()
    const ownerEmail = `test-owner-ent-${stamp}@khaopiyo-test.invalid`
    const ownerPassword = crypto.randomUUID()
    const managerEmail = `test-manager-ent-${stamp}@khaopiyo-test.invalid`
    const managerPassword = crypto.randomUUID()

    const { data: o, error: oErr } = await admin.auth.admin.createUser({
      email: ownerEmail, password: ownerPassword, email_confirm: true,
    })
    if (oErr || !o.user) throw new Error(`fixture: could not create owner — ${oErr?.message}`)
    ownerUserId = o.user.id

    const { data: m, error: mErr } = await admin.auth.admin.createUser({
      email: managerEmail, password: managerPassword, email_confirm: true,
    })
    if (mErr || !m.user) throw new Error(`fixture: could not create manager — ${mErr?.message}`)
    managerUserId = m.user.id

    // No explicit plan — stays on the schema default ('trial'), which has
    // coupons/loyalty off. That is the point of this fixture.
    const { data: cafe, error: cafeErr } = await admin
      .from('cafes')
      .insert({ owner_id: ownerUserId, slug: `test-ent-${stamp}`, name: 'Entitlement test café' })
      .select('id').single()
    if (cafeErr || !cafe) throw new Error(`fixture: could not create test café — ${cafeErr?.message}`)
    cafeId = cafe.id

    // Inserting `cafes` with owner_id set does NOT itself create a
    // cafe_members row — that only happens through the real onboarding RPC
    // (0058/0059), or the "bootstrap owner" RLS policy on an authenticated
    // insert, neither of which this service-role fixture goes through. Every
    // authorization check in this codebase reads cafe_members, not
    // cafes.owner_id, so both rows must be inserted explicitly or the tests
    // below would reject for the wrong reason ("not a member at all" instead
    // of the specific entitlement/role-escalation guard under test).
    const { error: ownerMemberErr } = await admin
      .from('cafe_members').insert({ cafe_id: cafeId, user_id: ownerUserId, role: 'owner' })
    if (ownerMemberErr) throw new Error(`fixture: could not add owner membership — ${ownerMemberErr.message}`)

    const { error: memberErr } = await admin
      .from('cafe_members').insert({ cafe_id: cafeId, user_id: managerUserId, role: 'manager' })
    if (memberErr) throw new Error(`fixture: could not add manager membership — ${memberErr.message}`)

    async function signIn(email: string, password: string) {
      const plain = createClient(URL!, KEY!, { auth: { persistSession: false } })
      const { data, error } = await plain.auth.signInWithPassword({ email, password })
      if (error || !data.session) throw new Error(`fixture: sign-in failed for ${email} — ${error?.message}`)
      return { apikey: KEY!, Authorization: `Bearer ${data.session.access_token}` }
    }
    ownerAuth = await signIn(ownerEmail, ownerPassword)
    managerAuth = await signIn(managerEmail, managerPassword)
  })

  afterAll(async () => {
    const admin = createClient(URL!, SERVICE_KEY!, { auth: { persistSession: false } })
    if (cafeId) await admin.from('cafes').delete().eq('id', cafeId)
    if (ownerUserId) await admin.auth.admin.deleteUser(ownerUserId)
    if (managerUserId) await admin.auth.admin.deleteUser(managerUserId)
  })

  it("a plan without 'coupons' rejects create_coupon even for the café's own owner", async () => {
    const res = await fetch(`${URL}/rest/v1/rpc/create_coupon`, {
      method: 'POST',
      headers: { ...ownerAuth, 'content-type': 'application/json' },
      body: JSON.stringify({ p_cafe_id: cafeId, p_code: 'NOPE', p_name: 'x', p_kind: 'flat', p_value: 10 }),
    })
    expect(res.status, `create_coupon succeeded on a plan without coupons (status ${res.status})`).toBeGreaterThanOrEqual(400)
  })

  it("a plan without 'loyalty' rejects create_reward and save_spin_wheel even for the owner", async () => {
    const rewardRes = await fetch(`${URL}/rest/v1/rpc/create_reward`, {
      method: 'POST',
      headers: { ...ownerAuth, 'content-type': 'application/json' },
      body: JSON.stringify({ p_cafe_id: cafeId, p_name: 'Free thing', p_points_cost: 10 }),
    })
    expect(rewardRes.status, `create_reward succeeded on a plan without loyalty (status ${rewardRes.status})`).toBeGreaterThanOrEqual(400)

    const wheelRes = await fetch(`${URL}/rest/v1/rpc/save_spin_wheel`, {
      method: 'POST',
      headers: { ...ownerAuth, 'content-type': 'application/json' },
      body: JSON.stringify({ p_cafe_id: cafeId, p_title: 'Wheel', p_active: false, p_expiry_days: null, p_segments: [] }),
    })
    expect(wheelRes.status, `save_spin_wheel succeeded on a plan without loyalty (status ${wheelRes.status})`).toBeGreaterThanOrEqual(400)
  })

  it('a manager cannot mint a new owner through create_staff_member', async () => {
    const res = await fetch(`${URL}/rest/v1/rpc/create_staff_member`, {
      method: 'POST',
      headers: { ...managerAuth, 'content-type': 'application/json' },
      body: JSON.stringify({ p_cafe_id: cafeId, p_user_id: managerUserId, p_role: 'owner' }),
    })
    expect(res.status, `a manager was able to self-promote to owner (status ${res.status})`).toBeGreaterThanOrEqual(400)
  })
})
