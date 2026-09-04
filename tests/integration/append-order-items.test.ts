// "Add items" on Live Tables used to always start a brand new order, even for
// a table that already had one open — reported live as a table showing
// "2 active orders · bill ₹348" for what was, to the customer, one sitting.
// append_order_items (migration 0218) lets staff grow the SAME bill instead.
//
// This suite exists to prove the parts that are genuinely new risk: the
// eligibility guard (an order must be refused the instant it's paid,
// cancelled, discounted, coupon'd, spin-prized, or GST-invoiced — 0218's own
// header explains why each of those is refused outright rather than
// half-supported), that a successful append actually grows the SAME order
// row rather than creating a second one, and that a retried call is
// idempotent. It deliberately does not re-test staff_place_order's own item-
// pricing/variant/addon logic — append_order_items duplicates that logic on
// purpose (see 0218's header), but the pricing rules themselves are already
// covered by order-engine.test.ts and combos.test.ts.
//
// Needs SUPABASE_SERVICE_ROLE_KEY locally; skips (not fails) without it, same
// convention as the other integration tests here.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) throw new Error('NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY not set (need .env.local)')

const hasAdmin = Boolean(URL && KEY && SERVICE_KEY)

describe.skipIf(!hasAdmin)('append_order_items (live)', () => {
  let admin: SupabaseClient
  let owner: SupabaseClient
  let cafeId: string
  let ownerUserId: string
  let itemAId: string
  let itemBId: string

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE_KEY!, { auth: { persistSession: false } })

    const stamp = Date.now()
    const email = `test-append-${stamp}@khaopiyo-test.invalid`
    const pass = crypto.randomUUID()
    const { data: u, error: uErr } = await admin.auth.admin.createUser({ email, password: pass, email_confirm: true })
    if (uErr || !u.user) throw new Error(`fixture: could not create owner — ${uErr?.message}`)
    ownerUserId = u.user.id

    const { data: cafe, error: cErr } = await admin
      .from('cafes')
      .insert({ owner_id: ownerUserId, slug: `test-append-${stamp}`, name: 'Append café', plan: 'business' })
      .select('id').single()
    if (cErr || !cafe) throw new Error(`fixture: could not create café — ${cErr?.message}`)
    cafeId = cafe.id

    const { error: mErr } = await admin.from('cafe_members').insert({ cafe_id: cafeId, user_id: ownerUserId, role: 'owner' })
    if (mErr) throw new Error(`fixture: could not add membership — ${mErr.message}`)

    const { data: itemA, error: aErr } = await admin
      .from('menu_items').insert({ cafe_id: cafeId, name: 'Chai', price: 100, available: true })
      .select('id').single()
    if (aErr || !itemA) throw new Error(`fixture: could not create item A — ${aErr?.message}`)
    itemAId = itemA.id

    const { data: itemB, error: bErr } = await admin
      .from('menu_items').insert({ cafe_id: cafeId, name: 'Samosa', price: 60, available: true })
      .select('id').single()
    if (bErr || !itemB) throw new Error(`fixture: could not create item B — ${bErr?.message}`)
    itemBId = itemB.id

    owner = createClient(URL!, KEY, { auth: { persistSession: false } })
    const { error: sErr } = await owner.auth.signInWithPassword({ email, password: pass })
    if (sErr) throw new Error(`fixture: owner sign-in failed — ${sErr.message}`)
  })

  afterAll(async () => {
    if (cafeId) await admin.from('cafes').delete().eq('id', cafeId)
    if (ownerUserId) await admin.auth.admin.deleteUser(ownerUserId)
  })

  async function placeOrder(opts: { settle?: boolean; discountType?: 'percent' | 'flat'; discountValue?: number } = {}): Promise<string> {
    const { data, error } = await owner.rpc('staff_place_order', {
      p_cafe_id: cafeId,
      p_order_type: 'takeaway',
      p_items: [{ item_id: itemAId, qty: 1 }],
      p_payment_method: opts.settle ? 'cash' : null,
      p_settle: opts.settle ?? false,
      p_discount_type: opts.discountType ?? null,
      p_discount_value: opts.discountValue ?? null,
    })
    if (error) throw new Error(`fixture: could not place order — ${error.message}`)
    return (data as { order_id: string }).order_id
  }

  it('order_appendable is true for a fresh unpaid order', { timeout: 40000 }, async () => {
    const orderId = await placeOrder()
    const { data, error } = await owner.rpc('order_appendable', { p_order_id: orderId })
    expect(error, error?.message).toBeNull()
    expect(data).toBe(true)
  })

  it('adds a line to the SAME order and recomputes the total, not a second order', { timeout: 40000 }, async () => {
    const orderId = await placeOrder() // Chai ₹100
    // Café is shared across this file's tests, so count orders around just
    // this call rather than asserting an absolute total for the café.
    const { data: before } = await admin.from('orders').select('id').eq('cafe_id', cafeId)
    const countBefore = before?.length ?? 0

    const { data, error } = await owner.rpc('append_order_items', {
      p_order_id: orderId,
      p_items: [{ item_id: itemBId, qty: 1 }], // + Samosa ₹60
    })
    expect(error, error?.message).toBeNull()
    const result = data as { order_id: string; subtotal: number; total: number; added_item_ids: string[] }
    expect(result.order_id).toBe(orderId)
    expect(result.subtotal).toBe(160)
    expect(result.added_item_ids.length).toBe(1)

    const { data: lines } = await admin.from('order_items').select('id, order_id, name').eq('order_id', orderId)
    expect(lines?.length, 'both lines must sit on the one order').toBe(2)
    expect(lines?.every((l) => l.order_id === orderId)).toBe(true)

    const { data: order } = await admin.from('orders').select('subtotal, total').eq('id', orderId).single()
    expect(order?.subtotal).toBe(160)
    expect(order?.total).toBe(result.total)

    // The append must not have created a second order row.
    const { data: after } = await admin.from('orders').select('id').eq('cafe_id', cafeId)
    expect(after?.length).toBe(countBefore)
  })

  it('is idempotent under the same client_request_id', { timeout: 40000 }, async () => {
    const orderId = await placeOrder()
    const requestId = crypto.randomUUID()

    const first = await owner.rpc('append_order_items', {
      p_order_id: orderId, p_items: [{ item_id: itemBId, qty: 1 }], p_client_request_id: requestId,
    })
    expect(first.error, first.error?.message).toBeNull()

    const second = await owner.rpc('append_order_items', {
      p_order_id: orderId, p_items: [{ item_id: itemBId, qty: 1 }], p_client_request_id: requestId,
    })
    expect(second.error, 'a retry with the same client_request_id must not error').toBeNull()
    expect((second.data as { added_item_ids: string[] }).added_item_ids)
      .toEqual((first.data as { added_item_ids: string[] }).added_item_ids)

    // The retry must not have inserted a second Samosa line.
    const { data: lines } = await admin.from('order_items').select('id').eq('order_id', orderId).eq('name', 'Samosa')
    expect(lines?.length).toBe(1)
  })

  it('refuses to append to a paid order', { timeout: 40000 }, async () => {
    const orderId = await placeOrder({ settle: true })

    const { data: appendable } = await owner.rpc('order_appendable', { p_order_id: orderId })
    expect(appendable).toBe(false)

    const { error } = await owner.rpc('append_order_items', { p_order_id: orderId, p_items: [{ item_id: itemBId, qty: 1 }] })
    expect(error, 'appending to a paid order must be refused').not.toBeNull()
    expect(error!.message).toMatch(/already been settled/i)
  })

  it('refuses to append to a cancelled order', { timeout: 40000 }, async () => {
    const orderId = await placeOrder()
    const { error: cancelErr } = await owner.rpc('cancel_order', { p_order_id: orderId, p_reason: 'test cleanup' })
    expect(cancelErr, cancelErr?.message).toBeNull()

    const { error } = await owner.rpc('append_order_items', { p_order_id: orderId, p_items: [{ item_id: itemBId, qty: 1 }] })
    expect(error, 'appending to a cancelled order must be refused').not.toBeNull()
    expect(error!.message).toMatch(/cancelled/i)
  })

  it('refuses to append once a discount has been applied', { timeout: 40000 }, async () => {
    const orderId = await placeOrder({ discountType: 'flat', discountValue: 10 })

    const { data: order } = await admin.from('orders').select('discount').eq('id', orderId).single()
    expect(order?.discount, 'fixture must actually carry a discount, or this test proves nothing').toBeGreaterThan(0)

    const { data: appendable } = await owner.rpc('order_appendable', { p_order_id: orderId })
    expect(appendable).toBe(false)

    const { error } = await owner.rpc('append_order_items', { p_order_id: orderId, p_items: [{ item_id: itemBId, qty: 1 }] })
    expect(error, 'appending to a discounted order must be refused').not.toBeNull()
    expect(error!.message).toMatch(/discount/i)
  })

  it('refuses an item that does not belong to this café', { timeout: 40000 }, async () => {
    const orderId = await placeOrder()
    const { error } = await owner.rpc('append_order_items', {
      p_order_id: orderId, p_items: [{ item_id: '00000000-0000-0000-0000-000000000000', qty: 1 }],
    })
    expect(error, 'an unknown/foreign item must be refused').not.toBeNull()
    expect(error!.message).toMatch(/not available/i)
  })

  it('order_appendable refuses a staff member from a different café', { timeout: 40000 }, async () => {
    const orderId = await placeOrder()

    const stamp = Date.now()
    const email = `test-append-other-${stamp}@khaopiyo-test.invalid`
    const pass = crypto.randomUUID()
    const { data: u } = await admin.auth.admin.createUser({ email, password: pass, email_confirm: true })
    const uid = u!.user!.id
    const { data: c } = await admin
      .from('cafes').insert({ owner_id: uid, slug: `test-append-other-${stamp}`, name: 'Other café', plan: 'business' })
      .select('id').single()
    await admin.from('cafe_members').insert({ cafe_id: c!.id, user_id: uid, role: 'owner' })

    const other = createClient(URL!, KEY, { auth: { persistSession: false } })
    await other.auth.signInWithPassword({ email, password: pass })

    const { error } = await other.rpc('order_appendable', { p_order_id: orderId })
    expect(error, 'a non-member must not be able to probe another café\'s order').not.toBeNull()
    expect(error!.message).toMatch(/not authorized/i)

    await admin.from('cafes').delete().eq('id', c!.id)
    await admin.auth.admin.deleteUser(uid)
  })
})
