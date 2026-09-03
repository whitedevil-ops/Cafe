// Self-serve Spin & Win redemption (migration 0214).
//
// Before this, a guest's only path to spend a won prize was "show staff at
// the counter" — there was no customer-facing redemption at all. This proves
// the new one end to end: preview a code without consuming it, redeem it by
// placing a real order through the SAME anon-callable RPC a guest's browser
// calls (place_order), and everything that must hold around that — one
// redemption per code, tenant isolation, expired/already-claimed rejection,
// and that an 'item' kind prize still requires the item on the bill.
//
// tests/integration/spin-prize.test.ts covers the STAFF redemption path
// (unchanged by 0214) and tests/integration/spin-visibility.test.ts covers
// what the wheel itself shows a guest. This file is specifically the new
// guest-redemption surface.
//
// Needs SUPABASE_SERVICE_ROLE_KEY locally; skips (not fails) without it, same
// convention as the rest of this directory.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) throw new Error('NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY not set (need .env.local)')

const hasAdmin = Boolean(URL && KEY && SERVICE_KEY)

const CHAI = 40
const SANDWICH = 150

describe.skipIf(!hasAdmin)('guest self-serve spin redemption (live)', () => {
  let admin: SupabaseClient
  let anon: SupabaseClient
  let owner: SupabaseClient
  let cafeId: string
  let otherCafeId: string
  let ownerUserId: string
  let tableToken: string
  let chaiId: string
  let sandwichId: string

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE_KEY!, { auth: { persistSession: false } })
    anon = createClient(URL!, KEY, { auth: { persistSession: false } })

    const stamp = Date.now()
    const email = `test-guestredeem-owner-${stamp}@khaopiyo-test.invalid`
    const pass = crypto.randomUUID()
    const { data: o } = await admin.auth.admin.createUser({ email, password: pass, email_confirm: true })
    ownerUserId = o!.user!.id

    const { data: cafe } = await admin
      .from('cafes')
      .insert({ owner_id: ownerUserId, slug: `test-guestredeem-${stamp}`, name: 'Guest redeem café', plan: 'business' })
      .select('id').single()
    cafeId = cafe!.id

    const { data: other } = await admin
      .from('cafes')
      .insert({ owner_id: ownerUserId, slug: `test-guestredeem-other-${stamp}`, name: 'Other café', plan: 'business' })
      .select('id').single()
    otherCafeId = other!.id

    await admin.from('cafe_members').insert([
      { cafe_id: cafeId, user_id: ownerUserId, role: 'owner' },
      { cafe_id: otherCafeId, user_id: ownerUserId, role: 'owner' },
    ])

    const { data: menu } = await admin
      .from('menu_items')
      .insert([
        { cafe_id: cafeId, name: 'Chai', price: CHAI, available: true },
        { cafe_id: cafeId, name: 'Sandwich', price: SANDWICH, available: true },
      ])
      .select('id, name')
    chaiId = menu!.find((m) => m.name === 'Chai')!.id
    sandwichId = menu!.find((m) => m.name === 'Sandwich')!.id

    const { data: tbl } = await admin
      .from('cafe_tables').insert({ cafe_id: cafeId, label: 'G1', token: `guestredeem-${stamp}` })
      .select('token').single()
    tableToken = tbl!.token

    owner = createClient(URL!, KEY, { auth: { persistSession: false } })
    await owner.auth.signInWithPassword({ email, password: pass })

    // Single deterministic percent slice, so every spin wins the same thing.
    await owner.rpc('save_spin_wheel', {
      p_cafe_id: cafeId, p_title: 'Spin & win', p_subtitle: null, p_active: true,
      p_expiry_days: 7, p_min_order_amount: 0, p_enable_confetti: true, p_enable_sound: true,
      p_segments: [{ label: '10% off next visit', kind: 'percent', value: 10, weight: 1 }],
    })
  })

  afterAll(async () => {
    if (cafeId) await admin.from('cafes').delete().eq('id', cafeId)
    if (otherCafeId) await admin.from('cafes').delete().eq('id', otherCafeId)
    if (ownerUserId) await admin.auth.admin.deleteUser(ownerUserId)
  })

  /** Places a real paid order and spins it, returning the won code. */
  async function winACode(): Promise<string> {
    const { data: res } = await owner.rpc('staff_place_order', {
      p_cafe_id: cafeId, p_order_type: 'takeaway',
      p_items: [{ item_id: chaiId, qty: 1 }], p_payment_method: 'cash', p_settle: true,
    })
    const { data: prize, error } = await anon.rpc('spin_the_wheel', { p_receipt_token: res.receipt_token })
    if (error) throw new Error(`fixture: spin failed — ${error.message}`)
    return (prize as { code: string }).code
  }

  it('previews a code without consuming it', { timeout: 40000 }, async () => {
    const code = await winACode()
    const { data, error } = await anon.rpc('preview_spin_prize_for_guest', { p_cafe_id: cafeId, p_code: code })
    expect(error, error?.message).toBeNull()
    expect(data.label).toBe('10% off next visit')
    expect(data.kind).toBe('percent')
    expect(data.redeemed).toBe(false)

    // Preview again — it must still be there, unconsumed.
    const { data: again, error: err2 } = await anon.rpc('preview_spin_prize_for_guest', { p_cafe_id: cafeId, p_code: code })
    expect(err2).toBeNull()
    expect(again.redeemed).toBe(false)
  })

  it('a guest redeems their own code by placing a real order — no staff involved', { timeout: 40000 }, async () => {
    const code = await winACode()

    const { data, error } = await anon.rpc('place_order', {
      p_token: tableToken,
      p_items: [{ item_id: sandwichId, qty: 1, variant_id: null, addon_ids: [] }],
      p_phone: null,
      p_payment_method: 'counter',
      p_spin_code: code,
    })
    expect(error, error?.message).toBeNull()
    const receiptToken = (data as { receipt_token: string }).receipt_token
    const { data: order } = await admin.from('orders').select('id, discount').eq('receipt_token', receiptToken).single()
    expect(order, 'the order must exist').not.toBeNull()
    // 10% of a ₹150 sandwich = ₹15.
    expect(order!.discount).toBe(15)

    const { data: result } = await admin.from('spin_results').select('redeemed_at, redeemed_order_id').eq('code', code).single()
    expect(result!.redeemed_at, 'permanently tied to the order it paid for, not the device').not.toBeNull()
    expect(result!.redeemed_order_id).toBe(order!.id)
  })

  it('one code = one redemption, even racing two placements at once', { timeout: 40000 }, async () => {
    const code = await winACode()

    // Fire both concurrently — this is the "duplicate clicks / two tabs"
    // scenario. The advisory lock inside redeem_spin_prize_core must
    // serialize them so exactly one order gets the discount and the other
    // is refused, never both succeeding.
    const attempt = () =>
      anon.rpc('place_order', {
        p_token: tableToken,
        p_items: [{ item_id: sandwichId, qty: 1, variant_id: null, addon_ids: [] }],
        p_phone: null,
        p_payment_method: 'counter',
        p_spin_code: code,
      })
    const [a, b] = await Promise.all([attempt(), attempt()])
    const outcomes = [a, b]
    const succeeded = outcomes.filter((o) => !o.error)
    const failed = outcomes.filter((o) => o.error)
    expect(succeeded.length, 'exactly one of the two concurrent redemptions must win').toBe(1)
    expect(failed.length).toBe(1)
    expect(failed[0].error!.message).toMatch(/already been claimed/i)

    const { data: result } = await admin.from('spin_results').select('redeemed_order_id').eq('code', code).single()
    expect(result!.redeemed_order_id, 'redeemed exactly once').not.toBeNull()
  })

  it('rejects an already-redeemed code with the whole order aborted, not a partial one', { timeout: 40000 }, async () => {
    const code = await winACode()
    // Redeem it once, honestly.
    await anon.rpc('place_order', {
      p_token: tableToken,
      p_items: [{ item_id: sandwichId, qty: 1, variant_id: null, addon_ids: [] }],
      p_phone: null, p_payment_method: 'counter', p_spin_code: code,
    })
    const { count: before } = await admin.from('orders').select('id', { count: 'exact', head: true }).eq('cafe_id', cafeId)

    const { error } = await anon.rpc('place_order', {
      p_token: tableToken,
      p_items: [{ item_id: sandwichId, qty: 1, variant_id: null, addon_ids: [] }],
      p_phone: null, p_payment_method: 'counter', p_spin_code: code,
    })
    expect(error, 'a second redemption of the same code must be refused').not.toBeNull()

    // The failed attempt must not have left a half-placed order behind — the
    // whole transaction rolls back, items and all.
    const { count: after } = await admin.from('orders').select('id', { count: 'exact', head: true }).eq('cafe_id', cafeId)
    expect(after).toBe(before)
  })

  it('rejects an expired code', { timeout: 40000 }, async () => {
    const code = await winACode()
    await admin.from('spin_results').update({ expires_at: new Date(Date.now() - 86_400_000).toISOString() }).eq('code', code)

    const { error } = await anon.rpc('place_order', {
      p_token: tableToken,
      p_items: [{ item_id: sandwichId, qty: 1, variant_id: null, addon_ids: [] }],
      p_phone: null, p_payment_method: 'counter', p_spin_code: code,
    })
    expect(error?.message).toMatch(/expired/i)
  })

  it('an item-kind prize requires the item on the bill, or the whole order is refused', { timeout: 40000 }, async () => {
    // Add an item-kind slice for this check.
    await owner.rpc('save_spin_wheel', {
      p_cafe_id: cafeId, p_title: 'Spin & win', p_subtitle: null, p_active: true,
      p_expiry_days: 7, p_min_order_amount: 0, p_enable_confetti: true, p_enable_sound: true,
      p_segments: [
        { label: '10% off next visit', kind: 'percent', value: 10, weight: 1 },
        { label: 'Free Chai', kind: 'item', menu_item_id: chaiId, value: 0, weight: 0 },
      ],
    })
    // Force the free-item slice by drawing until it lands (weight 0 on the
    // percent one after a re-save would be cleaner, but save_spin_wheel's
    // upsert-by-id semantics make a targeted re-weight fiddly here — instead,
    // just draw a few times and use whichever code turns out to be the item
    // prize; if none land in a reasonable number of tries the test fixture
    // itself is wrong, not the feature).
    let itemCode: string | null = null
    for (let i = 0; i < 20 && !itemCode; i++) {
      const { data: res } = await owner.rpc('staff_place_order', {
        p_cafe_id: cafeId, p_order_type: 'takeaway',
        p_items: [{ item_id: chaiId, qty: 1 }], p_payment_method: 'cash', p_settle: true,
      })
      const { data: prize } = await anon.rpc('spin_the_wheel', { p_receipt_token: res.receipt_token })
      if (prize.kind === 'item') itemCode = prize.code
    }
    expect(itemCode, 'fixture could not draw the item prize in 20 tries').not.toBeNull()

    // Order WITHOUT the won item — must be refused, whole order aborted.
    const { error } = await anon.rpc('place_order', {
      p_token: tableToken,
      p_items: [{ item_id: sandwichId, qty: 1, variant_id: null, addon_ids: [] }],
      p_phone: null, p_payment_method: 'counter', p_spin_code: itemCode,
    })
    expect(error?.message).toMatch(/add ".*" to your order/i)

    // Order WITH it — succeeds, discount equals the item's own price (free).
    const { data, error: err2 } = await anon.rpc('place_order', {
      p_token: tableToken,
      p_items: [{ item_id: chaiId, qty: 1, variant_id: null, addon_ids: [] }],
      p_phone: null, p_payment_method: 'counter', p_spin_code: itemCode,
    })
    expect(err2, err2?.message).toBeNull()
    expect((data as { discount: number }).discount).toBe(CHAI)
  })

  it('a code from one café cannot be redeemed through another café\'s ordering page', { timeout: 40000 }, async () => {
    const code = await winACode() // won at cafeId

    const { data: item } = await admin
      .from('menu_items').insert({ cafe_id: otherCafeId, name: 'Coffee', price: 100, available: true })
      .select('id').single()
    const { data: otherTbl } = await admin
      .from('cafe_tables').insert({ cafe_id: otherCafeId, label: 'O1', token: `otherredeem-${Date.now()}` })
      .select('token').single()

    const { error } = await anon.rpc('place_order', {
      p_token: otherTbl!.token,
      p_items: [{ item_id: item!.id, qty: 1, variant_id: null, addon_ids: [] }],
      p_phone: null, p_payment_method: 'counter', p_spin_code: code,
    })
    expect(error, 'a code scoped to a different café must not be found').not.toBeNull()
    expect(error!.message).toMatch(/no prize with that code/i)

    // And it must still be redeemable at its OWN café afterwards — the failed
    // cross-tenant attempt must not have consumed or damaged it.
    const { data: preview } = await anon.rpc('preview_spin_prize_for_guest', { p_cafe_id: cafeId, p_code: code })
    expect(preview.redeemed).toBe(false)
  })

  it('the staff redemption path is completely unaffected', { timeout: 40000 }, async () => {
    // Regression guard: 0214 refactored redeem_spin_prize into a thin wrapper
    // around the shared core. This proves the till still works exactly as
    // before — same function, same signature, same behaviour.
    const code = await winACode()
    const { data: res } = await owner.rpc('staff_place_order', {
      p_cafe_id: cafeId, p_order_type: 'takeaway',
      p_items: [{ item_id: sandwichId, qty: 1 }], p_payment_method: 'cash',
      p_settle: true, p_spin_code: code,
    })
    expect(res.discount).toBe(15)

    // And a guest still cannot call the staff-only wrapper directly.
    const { error } = await anon.rpc('redeem_spin_prize', { p_cafe_id: cafeId, p_code: code })
    expect(error, 'redeem_spin_prize must still be staff-only').not.toBeNull()
  })
})
