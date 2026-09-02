// What the guest's wheel actually says, for every state a real order can be in.
//
// Written after a café reported that Spin & Win "sometimes" does not appear.
// It sometimes did not appear because get_spin_wheel had several ways to
// answer with a payload the client renders as nothing, and no test anywhere
// asserted what a guest is told in the states that are not the happy path.
// spin-prize.test.ts covers redemption at the till and is deliberately not
// duplicated here; this file is about visibility and the reason given.
//
// The invariant under test, in one line: a café that is running a wheel never
// leaves a guest looking at empty space. Either the wheel is spinnable, or the
// guest is told why it isn't.
//
// Needs SUPABASE_SERVICE_ROLE_KEY locally to create/tear down a throwaway café
// fixture; skips (not fails) without it, same convention as spin-prize.test.ts.
//
// REQUIRES migration 0207. Several assertions here (the sold-out reason, the
// expired flag, refunded/cancelled reasons, order_total) are exactly what 0207
// adds, and spin_wheel_analytics does not exist in production without it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) throw new Error('NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY not set (need .env.local)')

const hasAdmin = Boolean(URL && KEY && SERVICE_KEY)

const CHAI = 40
const BIRYANI = 300
const MIN_ORDER = 100

type Wheel = {
  available: boolean
  title?: string
  reason?: string | null
  min_order_amount?: number
  order_total?: number
  segments: { id: string; label: string }[]
  result: { code: string; kind: string; expired?: boolean; redeemed?: boolean } | null
}

describe.skipIf(!hasAdmin)('spin wheel visibility (live)', () => {
  let admin: SupabaseClient
  let owner: SupabaseClient
  let anon: SupabaseClient
  let cafeId: string
  let otherCafeId: string
  let ownerUserId: string
  let chaiId: string
  let biryaniId: string

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE_KEY!, { auth: { persistSession: false } })
    anon = createClient(URL!, KEY, { auth: { persistSession: false } })

    const stamp = Date.now()
    const ownerEmail = `test-spinvis-owner-${stamp}@khaopiyo-test.invalid`
    const ownerPass = crypto.randomUUID()

    const { data: o, error: oErr } = await admin.auth.admin.createUser({ email: ownerEmail, password: ownerPass, email_confirm: true })
    if (oErr || !o.user) throw new Error(`fixture: could not create owner — ${oErr?.message}`)
    ownerUserId = o.user.id

    // 'business' so the plan grants 'spin'; the entitlement test below turns it
    // off with an override rather than by moving the café between plans.
    const { data: cafe, error: cafeErr } = await admin
      .from('cafes')
      .insert({ owner_id: ownerUserId, slug: `test-spinvis-${stamp}`, name: 'Spin visibility café', plan: 'business' })
      .select('id').single()
    if (cafeErr || !cafe) throw new Error(`fixture: could not create café — ${cafeErr?.message}`)
    cafeId = cafe.id

    // A second tenant, used only to prove one café's receipt token can never
    // surface another café's wheel.
    const { data: other, error: otherErr } = await admin
      .from('cafes')
      .insert({ owner_id: ownerUserId, slug: `test-spinvis-other-${stamp}`, name: 'Other café', plan: 'business' })
      .select('id').single()
    if (otherErr || !other) throw new Error(`fixture: could not create second café — ${otherErr?.message}`)
    otherCafeId = other.id

    const { error: memErr } = await admin.from('cafe_members').insert([
      { cafe_id: cafeId, user_id: ownerUserId, role: 'owner' },
      { cafe_id: otherCafeId, user_id: ownerUserId, role: 'owner' },
    ])
    if (memErr) throw new Error(`fixture: could not add memberships — ${memErr.message}`)

    const { data: menu, error: menuErr } = await admin
      .from('menu_items')
      .insert([
        { cafe_id: cafeId, name: 'Chai', price: CHAI, available: true },
        { cafe_id: cafeId, name: 'Biryani', price: BIRYANI, available: true },
      ])
      .select('id, name')
    if (menuErr || !menu) throw new Error(`fixture: could not create menu — ${menuErr?.message}`)
    chaiId = menu.find((m) => m.name === 'Chai')!.id
    biryaniId = menu.find((m) => m.name === 'Biryani')!.id

    owner = createClient(URL!, KEY, { auth: { persistSession: false } })
    const { error: sErr } = await owner.auth.signInWithPassword({ email: ownerEmail, password: ownerPass })
    if (sErr) throw new Error(`fixture: owner sign-in failed — ${sErr.message}`)

    // Deterministic single-prize wheel with a ₹100 minimum, so a Chai is
    // below it and a Biryani is above it.
    const { error: wheelErr } = await owner.rpc('save_spin_wheel', {
      p_cafe_id: cafeId,
      p_title: 'Spin & win',
      p_subtitle: null,
      p_active: true,
      p_expiry_days: 7,
      p_min_order_amount: MIN_ORDER,
      p_enable_confetti: true,
      p_enable_sound: true,
      p_segments: [{ label: '10% off next visit', kind: 'percent', value: 10, weight: 1 }],
    })
    if (wheelErr) throw new Error(`fixture: could not save wheel — ${wheelErr.message}`)
  })

  afterAll(async () => {
    if (cafeId) await admin.from('cafes').delete().eq('id', cafeId)
    if (otherCafeId) await admin.from('cafes').delete().eq('id', otherCafeId)
    if (ownerUserId) await admin.auth.admin.deleteUser(ownerUserId)
  })

  /** Sell a bill and hand back its receipt token, settled or not. */
  async function sell(itemId: string, settle: boolean, cafe = cafeId): Promise<string> {
    const { data, error } = await owner.rpc('staff_place_order', {
      p_cafe_id: cafe,
      p_order_type: 'takeaway',
      p_items: [{ item_id: itemId, qty: 1 }],
      p_payment_method: 'cash',
      p_settle: settle,
    })
    if (error) throw new Error(`fixture: could not sell — ${error.message}`)
    return (data as { receipt_token: string }).receipt_token
  }

  async function wheelFor(token: string): Promise<Wheel> {
    const { data, error } = await anon.rpc('get_spin_wheel', { p_receipt_token: token })
    expect(error, error?.message).toBeNull()
    return data as Wheel
  }

  it('a paid order over the minimum can spin', { timeout: 40000 }, async () => {
    const w = await wheelFor(await sell(biryaniId, true))
    expect(w.title, 'the wheel identifies itself so the client can render it').toBe('Spin & win')
    expect(w.available).toBe(true)
    expect(w.reason).toBeNull()
    expect(w.segments.length).toBe(1)
  })

  it('an unpaid order is told what unlocks the spin, not left blank', { timeout: 40000 }, async () => {
    const w = await wheelFor(await sell(biryaniId, false))
    expect(w.available).toBe(false)
    expect(w.reason).toBe('unpaid')
    // The title is what the client keys "there is a wheel here" on. Without
    // it the whole section renders as nothing — the original bug.
    expect(w.title).toBe('Spin & win')
  })

  it('a below-minimum order says so AND carries both numbers', { timeout: 40000 }, async () => {
    const w = await wheelFor(await sell(chaiId, true))
    expect(w.available).toBe(false)
    expect(w.reason).toBe('below_minimum')
    expect(w.min_order_amount).toBe(MIN_ORDER)
    // order_total is what lets the guest be told how far short they are, which
    // is the one moment this feature could grow the order it is attached to.
    expect(w.order_total).toBe(CHAI)
  })

  it('a spun order shows the prize, and a second spin cannot mint another', { timeout: 40000 }, async () => {
    const token = await sell(biryaniId, true)
    const { data: prize, error } = await anon.rpc('spin_the_wheel', { p_receipt_token: token })
    expect(error, error?.message).toBeNull()
    const code = (prize as { code: string }).code

    // The second call is the two-tabs case: tab B still thinks it can spin.
    const { error: again } = await anon.rpc('spin_the_wheel', { p_receipt_token: token })
    expect(again, 'a second spin on the same order must be refused').not.toBeNull()

    // ...and re-reading state is what tab B does next, so it must show the
    // prize tab A won rather than an empty wheel plus an error.
    const w = await wheelFor(token)
    expect(w.available).toBe(false)
    expect(w.reason).toBe('spun')
    expect(w.result?.code).toBe(code)
    expect(w.result?.redeemed).toBe(false)
    expect(w.result?.expired).toBe(false)
  })

  it('an expired code is reported as expired, not as claimable', { timeout: 40000 }, async () => {
    const token = await sell(biryaniId, true)
    const { error } = await anon.rpc('spin_the_wheel', { p_receipt_token: token })
    expect(error, error?.message).toBeNull()

    // Backdate the expiry the way a week passing would.
    const { data: order } = await admin.from('orders').select('id').eq('receipt_token', token).single()
    await admin
      .from('spin_results')
      .update({ expires_at: new Date(Date.now() - 86_400_000).toISOString() })
      .eq('order_id', order!.id)

    const w = await wheelFor(token)
    expect(w.result?.expired, 'the receipt and the till must agree a code is dead').toBe(true)
  })

  it('a refunded order gets its own reason instead of "not paid yet"', { timeout: 40000 }, async () => {
    const token = await sell(biryaniId, true)
    await admin.from('orders').update({ payment_status: 'refunded' }).eq('receipt_token', token)
    const w = await wheelFor(token)
    expect(w.available).toBe(false)
    // 'unpaid' would tell the guest to wait for a payment that is never coming.
    expect(w.reason).toBe('refunded')
  })

  it('the dial only shows prizes that can still be won', { timeout: 40000 }, async () => {
    const token = await sell(biryaniId, true)

    // Sell out the only prize.
    const { data: wheelRow } = await admin.from('spin_wheels').select('id').eq('cafe_id', cafeId).single()
    await admin.from('spin_segments').update({ max_claims: 1, claims_used: 1 }).eq('wheel_id', wheelRow!.id)

    const w = await wheelFor(token)
    expect(w.segments.length, 'a sold-out slice must not be drawn on the dial').toBe(0)
    expect(w.available).toBe(false)
    expect(w.reason).toBe('sold_out')

    await admin.from('spin_segments').update({ max_claims: null, claims_used: 0 }).eq('wheel_id', wheelRow!.id)
  })

  it('turning the entitlement off hides the wheel and nothing else', { timeout: 40000 }, async () => {
    const token = await sell(biryaniId, true)
    await admin.from('cafe_feature_overrides').insert({ cafe_id: cafeId, feature_key: 'spin', enabled: false })

    const w = await wheelFor(token)
    // No title = "no wheel here", which is what a guest of a café that does
    // not sell this should see. Quoting plan names at a customer would be
    // worse than silence; the OWNER is told plainly on /dashboard/spin.
    expect(w.title).toBeUndefined()
    expect(w.available).toBe(false)

    await admin.from('cafe_feature_overrides').delete().eq('cafe_id', cafeId).eq('feature_key', 'spin')
    const back = await wheelFor(token)
    expect(back.title, 'and it comes straight back when re-enabled').toBe('Spin & win')
  })

  it('one café\'s receipt token can never surface another café\'s wheel', { timeout: 40000 }, async () => {
    // The second café has no wheel at all, so if scoping leaked it would show
    // the first café's.
    const { data: item } = await admin
      .from('menu_items').insert({ cafe_id: otherCafeId, name: 'Coffee', price: BIRYANI, available: true })
      .select('id').single()
    const token = await sell(item!.id, true, otherCafeId)

    const w = await wheelFor(token)
    expect(w.title, 'a café with no wheel must not borrow one').toBeUndefined()
    expect(w.available).toBe(false)
  })

  it('an unknown receipt token is refused without leaking whether it exists', { timeout: 40000 }, async () => {
    const w = await wheelFor('00000000-0000-4000-a000-0000000000ff')
    expect(w.available).toBe(false)
    // Byte-identical to the no-wheel answer, on purpose.
    expect(w.title).toBeUndefined()
  })

  it('the owner analytics RPC exists and answers', { timeout: 40000 }, async () => {
    // Regression guard for the real find: spin_wheel_analytics lived only in
    // migration 0191, which was never applied, so this returned 404 PGRST202
    // in production and the owner's analytics panel was permanently blank
    // with no error anywhere to explain it.
    const { data, error } = await owner.rpc('spin_wheel_analytics', {
      p_cafe_id: cafeId,
      p_from: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      p_to: new Date(Date.now() + 86_400_000).toISOString(),
    })
    expect(error, error?.message).toBeNull()
    const a = data as { total_spins: number; prizes: unknown[] }
    expect(a.total_spins, 'this fixture has spun several times by now').toBeGreaterThan(0)
    expect(Array.isArray(a.prizes)).toBe(true)
  })

  it('a guest cannot look up or redeem prize codes directly', { timeout: 40000 }, async () => {
    const { error: findErr } = await anon.rpc('find_spin_prize', { p_cafe_id: cafeId, p_code: 'WAAAAA' })
    expect(findErr, 'find_spin_prize is staff-only').not.toBeNull()

    const { error: redeemErr } = await anon.rpc('redeem_spin_prize', { p_cafe_id: cafeId, p_code: 'WAAAAA' })
    expect(redeemErr, 'redeem_spin_prize is staff-only — prizes are honoured at the till').not.toBeNull()
  })
})
