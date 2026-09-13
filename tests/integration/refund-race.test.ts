// Regression test for the HIGH-severity over-refund race found by the
// 2026-09-13 production maturity audit and fixed in migration 0240:
// refund_order() read order_refunded_total() with no lock before checking
// the remaining refundable amount, the exact same shape of bug that produced
// a live ₹158-vs-₹79 double payment before record_payment was fixed the same
// way (0180). Two concurrent refund_order calls each requesting more than
// half the order's total must not both succeed — mirrors
// race-conditions.test.ts's existing Promise.all pattern for the equivalent
// already-fixed loyalty/coupon races.
//
// Needs SUPABASE_SERVICE_ROLE_KEY locally to create/tear down a throwaway
// café fixture; skips (not fails) without it, same convention as the other
// integration suites.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) throw new Error('NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY not set (need .env.local)')

const hasAdmin = Boolean(URL && KEY && SERVICE_KEY)

describe.skipIf(!hasAdmin)('refund_order concurrency regression guard (live)', () => {
  let admin: SupabaseClient
  let owner: SupabaseClient
  let cafeId: string
  let ownerUserId: string

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE_KEY!, { auth: { persistSession: false } })
    const email = `test-refundrace-${Date.now()}@khaopiyo-test.invalid`
    const password = crypto.randomUUID()

    const { data: userRes, error: userErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (userErr || !userRes.user) throw new Error(`fixture: could not create test user — ${userErr?.message}`)
    ownerUserId = userRes.user.id

    const { data: cafe, error: cafeErr } = await admin
      .from('cafes')
      .insert({ owner_id: ownerUserId, slug: `test-refundrace-${Date.now()}`, name: 'Refund race test café' })
      .select('id').single()
    if (cafeErr || !cafe) throw new Error(`fixture: could not create test café — ${cafeErr?.message}`)
    cafeId = cafe.id

    const { error: memberErr } = await admin.from('cafe_members').insert({ cafe_id: cafeId, user_id: ownerUserId, role: 'owner' })
    if (memberErr) throw new Error(`fixture: could not add owner membership — ${memberErr.message}`)

    owner = createClient(URL!, KEY, { auth: { persistSession: false } })
    const { data: session, error: signInErr } = await owner.auth.signInWithPassword({ email, password })
    if (signInErr || !session.session) throw new Error(`fixture: owner sign-in failed — ${signInErr?.message}`)
  })

  afterAll(async () => {
    if (cafeId) await admin.from('cafes').delete().eq('id', cafeId)
    if (ownerUserId) await admin.auth.admin.deleteUser(ownerUserId)
  })

  it('two concurrent refunds for over half the order each cannot both succeed', { timeout: 30000 }, async () => {
    const { data: item, error: itemErr } = await admin
      .from('menu_items').insert({ cafe_id: cafeId, name: 'Refund Race Item', price: 1000, available: true }).select('id').single()
    if (itemErr || !item) throw new Error(`fixture: could not create menu item — ${itemErr?.message}`)

    const { data: sale, error: sellErr } = await owner.rpc('staff_place_order', {
      p_cafe_id: cafeId,
      p_order_type: 'takeaway',
      p_items: [{ item_id: item.id, qty: 1 }],
      p_payment_method: 'cash',
      p_settle: true,
    })
    if (sellErr || !sale) throw new Error(`fixture: could not place+settle order — ${sellErr?.message}`)
    const orderId = (sale as { order_id: string }).order_id

    const { data: order, error: orderErr } = await admin.from('orders').select('total').eq('id', orderId).single()
    if (orderErr || !order) throw new Error(`fixture: could not read order total — ${orderErr?.message}`)
    const total = order.total as number

    // Each request alone is valid (well under the total); together they sum
    // to 120% of it — only possible for both to succeed if the race exists.
    const each = Math.ceil(total * 0.6)

    const [r1, r2] = await Promise.all([
      owner.rpc('refund_order', { p_order_id: orderId, p_reason: 'race test 1', p_method: 'cash', p_amount: each }),
      owner.rpc('refund_order', { p_order_id: orderId, p_reason: 'race test 2', p_method: 'cash', p_amount: each }),
    ])

    const succeeded = [r1, r2].filter((r) => !r.error)
    const failed = [r1, r2].filter((r) => r.error)
    expect(succeeded, 'both concurrent over-half refunds succeeded — the race is not fixed').toHaveLength(1)
    expect(failed).toHaveLength(1)
    expect(failed[0].error?.message ?? '').toMatch(/remains unrefunded|already been fully refunded/i)

    const { data: refunds } = await admin.from('refunds').select('amount').eq('order_id', orderId).eq('status', 'completed')
    const refunded = (refunds ?? []).reduce((s, r) => s + (r.amount as number), 0)
    expect(refunded, 'total refunded exceeded the order total').toBeLessThanOrEqual(total)
  })

  it('a single valid refund still works normally — the fix did not break the happy path', async () => {
    const { data: item, error: itemErr } = await admin
      .from('menu_items').insert({ cafe_id: cafeId, name: 'Refund Happy Path Item', price: 400, available: true }).select('id').single()
    if (itemErr || !item) throw new Error(`fixture: could not create menu item — ${itemErr?.message}`)

    const { data: sale, error: sellErr } = await owner.rpc('staff_place_order', {
      p_cafe_id: cafeId,
      p_order_type: 'takeaway',
      p_items: [{ item_id: item.id, qty: 1 }],
      p_payment_method: 'cash',
      p_settle: true,
    })
    if (sellErr || !sale) throw new Error(`fixture: could not place+settle order — ${sellErr?.message}`)
    const orderId = (sale as { order_id: string }).order_id

    const { data, error } = await owner.rpc('refund_order', {
      p_order_id: orderId, p_reason: 'happy path', p_method: 'cash', p_amount: 100,
    })
    expect(error).toBeFalsy()
    expect(data).toBeTruthy()
  })
})
