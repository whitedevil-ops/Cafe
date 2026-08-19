// Regression tests for the two concurrency bugs found in the 2026-07-25 full
// audit: loyalty-point redemption and coupon usage-limit enforcement both
// read a count/balance with no row lock, so two simultaneous requests could
// both pass the check before either write committed (a classic TOCTOU race).
// Fixed in migration 0071 with pg_advisory_xact_lock. These tests fire two
// truly concurrent requests via Promise.all and assert exactly one wins —
// the actual failure mode being guarded against, not just a unit check of
// the SQL in isolation.
//
// Needs SUPABASE_SERVICE_ROLE_KEY locally to create/tear down a throwaway
// café fixture; skips (not fails) without it, same convention as the F-01
// test in security-boundaries.test.ts.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) throw new Error('NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY not set (need .env.local)')

const hasAdmin = Boolean(URL && KEY && SERVICE_KEY)

describe.skipIf(!hasAdmin)('concurrency race-condition regression guards (live)', () => {
  let admin: SupabaseClient
  let owner: SupabaseClient
  let cafeId: string
  let ownerUserId: string

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE_KEY!, { auth: { persistSession: false } })
    const email = `test-owner-${Date.now()}@khaopiyo-test.invalid`
    const password = crypto.randomUUID()

    const { data: userRes, error: userErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
    })
    if (userErr || !userRes.user) throw new Error(`fixture: could not create test user — ${userErr?.message}`)
    ownerUserId = userRes.user.id

    const { data: cafe, error: cafeErr } = await admin
      .from('cafes')
      // plan: 'business' — redeem_reward/resolve_coupon_discount are gated
      // behind the 'coupons'/'loyalty' features (migration 0143); the
      // default 'trial' plan has both off, which would fail every RPC call
      // below before ever reaching the race scenario under test.
      .insert({ owner_id: ownerUserId, slug: `test-race-${Date.now()}`, name: 'Race-condition test café', plan: 'business' })
      .select('id').single()
    if (cafeErr || !cafe) throw new Error(`fixture: could not create test café — ${cafeErr?.message}`)
    cafeId = cafe.id

    // redeem_reward/staff_place_order both authorize off cafe_members, not
    // cafes.owner_id — the real onboarding flow inserts this row via the
    // "bootstrap owner" RLS policy right after creating the café. Without
    // it every attempt() call below fails closed with "not authorized for
    // this café" before either race even gets a chance to run.
    const { error: memberErr } = await admin
      .from('cafe_members')
      .insert({ cafe_id: cafeId, user_id: ownerUserId, role: 'owner' })
    if (memberErr) throw new Error(`fixture: could not add owner membership — ${memberErr.message}`)

    owner = createClient(URL!, KEY, { auth: { persistSession: false } })
    const { data: session, error: signInErr } = await owner.auth.signInWithPassword({ email, password })
    if (signInErr || !session.session) throw new Error(`fixture: owner sign-in failed — ${signInErr?.message}`)
  })

  afterAll(async () => {
    if (cafeId) await admin.from('cafes').delete().eq('id', cafeId)
    if (ownerUserId) await admin.auth.admin.deleteUser(ownerUserId)
  })

  it('two concurrent reward redemptions for the same balance cannot both succeed', { timeout: 30000 }, async () => {
    const phone = '9812345678'
    const { data: customer, error: custErr } = await admin
      .from('customers').insert({ cafe_id: cafeId, phone, name: 'Race Customer' }).select('id').single()
    if (custErr || !customer) throw new Error(`fixture: could not create customer — ${custErr?.message}`)

    const { data: account, error: acctErr } = await admin
      .from('loyalty_accounts').insert({ cafe_id: cafeId, customer_id: customer.id }).select('id').single()
    if (acctErr || !account) throw new Error(`fixture: could not create loyalty account — ${acctErr?.message}`)

    // Exactly enough points for ONE redemption, never two.
    const { error: earnErr } = await admin
      .from('loyalty_transactions')
      .insert({ cafe_id: cafeId, account_id: account.id, kind: 'earn', points: 100, reason: 'fixture' })
    if (earnErr) throw new Error(`fixture: could not credit points — ${earnErr.message}`)

    const { data: reward, error: rewardErr } = await admin
      .from('rewards').insert({ cafe_id: cafeId, name: 'Race reward', points_cost: 100 }).select('id').single()
    if (rewardErr || !reward) throw new Error(`fixture: could not create reward — ${rewardErr?.message}`)

    const attempt = () => owner.rpc('redeem_reward', {
      p_cafe_id: cafeId, p_customer_phone: phone, p_reward_id: reward.id,
    })
    const [a, b] = await Promise.all([attempt(), attempt()])

    const succeeded = [a, b].filter((r) => !r.error)
    const failed = [a, b].filter((r) => r.error)
    expect(succeeded.length, 'exactly one concurrent redemption should succeed').toBe(1)
    expect(failed.length, 'exactly one concurrent redemption should be rejected for insufficient points').toBe(1)

    const { data: balanceRow } = await admin
      .from('loyalty_transactions').select('points').eq('account_id', account.id)
    const finalBalance = (balanceRow ?? []).reduce((s, r) => s + (r.points as number), 0)
    expect(finalBalance, 'balance must never go negative from a race').toBeGreaterThanOrEqual(0)
  })

  it('two concurrent staff_place_order calls redeeming the same reward cannot both succeed', { timeout: 30000 }, async () => {
    const phone = '9812345679'
    const { data: customer, error: custErr } = await admin
      .from('customers').insert({ cafe_id: cafeId, phone, name: 'Race Reward Customer' }).select('id').single()
    if (custErr || !customer) throw new Error(`fixture: could not create customer — ${custErr?.message}`)

    const { data: account, error: acctErr } = await admin
      .from('loyalty_accounts').insert({ cafe_id: cafeId, customer_id: customer.id }).select('id').single()
    if (acctErr || !account) throw new Error(`fixture: could not create loyalty account — ${acctErr?.message}`)

    // Exactly enough points for ONE redemption, never two.
    const { error: earnErr } = await admin
      .from('loyalty_transactions')
      .insert({ cafe_id: cafeId, account_id: account.id, kind: 'earn', points: 100, reason: 'fixture' })
    if (earnErr) throw new Error(`fixture: could not credit points — ${earnErr.message}`)

    const { data: item, error: itemErr } = await admin
      .from('menu_items').insert({ cafe_id: cafeId, name: 'Race Reward Item', price: 150, available: true }).select('id').single()
    if (itemErr || !item) throw new Error(`fixture: could not create menu item — ${itemErr?.message}`)

    const { data: reward, error: rewardErr } = await admin
      .from('rewards').insert({ cafe_id: cafeId, name: 'Race order reward', points_cost: 100, menu_item_id: item.id }).select('id').single()
    if (rewardErr || !reward) throw new Error(`fixture: could not create reward — ${rewardErr?.message}`)

    const attempt = () => owner.rpc('staff_place_order', {
      p_cafe_id: cafeId,
      p_items: [{ item_id: item.id, qty: 1, reward_id: reward.id }],
      p_order_type: 'takeaway',
      p_customer_phone: phone,
    })
    const [a, b] = await Promise.all([attempt(), attempt()])

    const succeeded = [a, b].filter((r) => !r.error)
    const failed = [a, b].filter((r) => r.error)
    expect(succeeded.length, 'exactly one concurrent order should win the reward').toBe(1)
    expect(failed.length, 'the other concurrent order should be rejected for insufficient points').toBe(1)

    const { data: balanceRow } = await admin
      .from('loyalty_transactions').select('points').eq('account_id', account.id)
    const finalBalance = (balanceRow ?? []).reduce((s, r) => s + (r.points as number), 0)
    expect(finalBalance, 'balance must never go negative from a race').toBeGreaterThanOrEqual(0)

    // The redeemed line must actually be a real, free order_items row tied
    // to the reward — this is the entire point of the fix (was: only a
    // points debit, nothing ever added to any order).
    const { data: orderItems } = await admin
      .from('order_items').select('price, reward_id').eq('reward_id', reward.id)
    expect(orderItems?.length, 'exactly one order should have redeemed this reward').toBe(1)
    expect(orderItems?.[0].price, 'a redeemed reward line must be priced at ₹0').toBe(0)
  })

  it('two concurrent orders redeeming a single-use coupon cannot both succeed', { timeout: 30000 }, async () => {
    const { data: item, error: itemErr } = await admin
      .from('menu_items').insert({ cafe_id: cafeId, name: 'Race Item', price: 100, available: true }).select('id').single()
    if (itemErr || !item) throw new Error(`fixture: could not create menu item — ${itemErr?.message}`)

    const code = `RACE${Date.now()}`
    const { error: couponErr } = await admin
      .from('coupons').insert({ cafe_id: cafeId, code, kind: 'flat', value: 10, usage_limit: 1, active: true })
    if (couponErr) throw new Error(`fixture: could not create coupon — ${couponErr.message}`)

    const attempt = () => owner.rpc('staff_place_order', {
      p_cafe_id: cafeId,
      p_items: [{ item_id: item.id, qty: 1 }],
      p_order_type: 'takeaway',
      p_coupon_code: code,
    })
    const [a, b] = await Promise.all([attempt(), attempt()])

    const succeeded = [a, b].filter((r) => !r.error)
    const failed = [a, b].filter((r) => r.error)
    expect(succeeded.length, 'exactly one concurrent order should win the single-use coupon').toBe(1)
    expect(failed.length, 'the other concurrent order should be rejected once the limit is reached').toBe(1)

    const { data: redemptions } = await admin
      .from('coupon_redemptions').select('id').eq('cafe_id', cafeId)
    expect((redemptions ?? []).length, 'a usage_limit=1 coupon must never redeem twice').toBeLessThanOrEqual(1)
  })
})
