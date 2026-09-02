// A bill cannot be deleted, and deleting a café still can (migration 0211).
//
// Written after four orders — #4 to #7, all guest QR orders — were deleted
// straight out of the orders table on 2026-09-02. The bill sequence jumped
// from #3 to #8, two table sessions were left orphaned holding tables at ₹0,
// and nothing anywhere recorded the removal. Nothing in the app could have
// done it: no delete path in any migration, function or component, no RLS
// DELETE policy, no DELETE grant. It came through the service-role key.
//
// That key cannot be made less powerful — it is the key. So the database
// refuses instead, because a trigger fires for the service role exactly as it
// does for everyone else.
//
// The interesting half of this test is the SECOND one. A naive "block all
// deletes" guard also blocks the ON DELETE CASCADE from cafes, which would
// break op_delete_cafe, reset-demo-cafe.sql, and the afterAll of every other
// integration test in this directory. Both halves have to hold at once.
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

describe.skipIf(!hasAdmin)('financial rows cannot be deleted (live)', () => {
  let admin: SupabaseClient
  let owner: SupabaseClient
  let cafeId: string
  let ownerUserId: string
  let itemId: string

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE_KEY!, { auth: { persistSession: false } })

    const stamp = Date.now()
    const email = `test-delguard-${stamp}@khaopiyo-test.invalid`
    const pass = crypto.randomUUID()
    const { data: u, error: uErr } = await admin.auth.admin.createUser({ email, password: pass, email_confirm: true })
    if (uErr || !u.user) throw new Error(`fixture: could not create owner — ${uErr?.message}`)
    ownerUserId = u.user.id

    const { data: cafe, error: cErr } = await admin
      .from('cafes')
      .insert({ owner_id: ownerUserId, slug: `test-delguard-${stamp}`, name: 'Delete guard café', plan: 'business' })
      .select('id').single()
    if (cErr || !cafe) throw new Error(`fixture: could not create café — ${cErr?.message}`)
    cafeId = cafe.id

    const { error: mErr } = await admin.from('cafe_members').insert({ cafe_id: cafeId, user_id: ownerUserId, role: 'owner' })
    if (mErr) throw new Error(`fixture: could not add membership — ${mErr.message}`)

    const { data: item, error: iErr } = await admin
      .from('menu_items').insert({ cafe_id: cafeId, name: 'Chai', price: 40, available: true })
      .select('id').single()
    if (iErr || !item) throw new Error(`fixture: could not create menu item — ${iErr?.message}`)
    itemId = item.id

    owner = createClient(URL!, KEY, { auth: { persistSession: false } })
    const { error: sErr } = await owner.auth.signInWithPassword({ email, password: pass })
    if (sErr) throw new Error(`fixture: owner sign-in failed — ${sErr.message}`)
  })

  afterAll(async () => {
    // This is itself the second assertion, run for real: if the guard blocked
    // the cascade, cleanup would fail and leave a café behind.
    if (cafeId) await admin.from('cafes').delete().eq('id', cafeId)
    if (ownerUserId) await admin.auth.admin.deleteUser(ownerUserId)
  })

  async function sellOne(): Promise<string> {
    const { data, error } = await owner.rpc('staff_place_order', {
      p_cafe_id: cafeId,
      p_order_type: 'takeaway',
      p_items: [{ item_id: itemId, qty: 1 }],
      p_payment_method: 'cash',
      p_settle: true,
    })
    if (error) throw new Error(`fixture: could not sell — ${error.message}`)
    return (data as { order_id: string }).order_id
  }

  it('refuses to delete an order, even with the service-role key', { timeout: 40000 }, async () => {
    const orderId = await sellOne()

    // The service role bypasses RLS entirely — this is exactly the power that
    // removed #4-#7. The trigger is what stops it.
    const { error } = await admin.from('orders').delete().eq('id', orderId)
    expect(error, 'the delete must be refused').not.toBeNull()
    expect(error!.message).toMatch(/financial record/i)

    const { data: still } = await admin.from('orders').select('id').eq('id', orderId).maybeSingle()
    expect(still?.id, 'and the order must still be there afterwards').toBe(orderId)
  })

  it('refuses to delete order lines and payments too', { timeout: 40000 }, async () => {
    const orderId = await sellOne()

    const { data: lines } = await admin.from('order_items').select('id').eq('order_id', orderId)
    expect(lines?.length, 'the fixture order should have a line').toBeGreaterThan(0)
    const { error: lineErr } = await admin.from('order_items').delete().eq('id', lines![0].id)
    expect(lineErr, 'deleting a bill line must be refused').not.toBeNull()

    // p_settle: true means this order has a payment against it.
    const { data: pays } = await admin.from('payments').select('id').eq('order_id', orderId)
    expect(pays?.length, 'a settled order should have a payment').toBeGreaterThan(0)
    const { error: payErr } = await admin.from('payments').delete().eq('id', pays![0].id)
    expect(payErr, 'deleting a payment must be refused').not.toBeNull()
  })

  it('still lets a café be deleted, taking its orders with it', { timeout: 40000 }, async () => {
    // The half that a naive guard breaks. op_delete_cafe, reset-demo-cafe.sql
    // and every other integration test's cleanup depend on this cascade.
    const stamp = Date.now()
    const email = `test-delguard-cascade-${stamp}@khaopiyo-test.invalid`
    const pass = crypto.randomUUID()
    const { data: u } = await admin.auth.admin.createUser({ email, password: pass, email_confirm: true })
    const uid = u!.user!.id

    const { data: c } = await admin
      .from('cafes')
      .insert({ owner_id: uid, slug: `test-delguard-c-${stamp}`, name: 'Cascade café', plan: 'business' })
      .select('id').single()
    await admin.from('cafe_members').insert({ cafe_id: c!.id, user_id: uid, role: 'owner' })
    const { data: mi } = await admin
      .from('menu_items').insert({ cafe_id: c!.id, name: 'Chai', price: 40, available: true })
      .select('id').single()

    const tmp = createClient(URL!, KEY, { auth: { persistSession: false } })
    await tmp.auth.signInWithPassword({ email, password: pass })
    const { data: res, error: sellErr } = await tmp.rpc('staff_place_order', {
      p_cafe_id: c!.id,
      p_order_type: 'takeaway',
      p_items: [{ item_id: mi!.id, qty: 1 }],
      p_payment_method: 'cash',
      p_settle: true,
    })
    expect(sellErr, sellErr?.message).toBeNull()
    const orderId = (res as { order_id: string }).order_id

    const { error: delErr } = await admin.from('cafes').delete().eq('id', c!.id)
    expect(delErr, 'deleting a café must still work').toBeNull()

    const { data: gone } = await admin.from('orders').select('id').eq('id', orderId).maybeSingle()
    expect(gone, 'and its orders must have gone with it').toBeNull()

    await admin.auth.admin.deleteUser(uid)
  })

  it('still lets an owner delete a table that has been used', { timeout: 40000 }, async () => {
    // The regression 0211 shipped and 0212 fixed, kept as a test because it is
    // the exact shape of mistake this guard invites: enumerate a table's
    // cascading parents, miss one, and break an ordinary feature.
    //
    // Chain: cafe_tables -> table_sessions (0012:21, cascade) -> payments
    // (0012:59, cascade). staff_place_order stamps session_id on the payment
    // of every settled dine-in order, so this is not an edge case — it is
    // every table that has ever been used.
    const { data: tbl } = await admin
      .from('cafe_tables')
      .insert({ cafe_id: cafeId, label: `D${Date.now() % 1000}`, token: `delguard-${Date.now()}` })
      .select('id').single()

    const { error: sellErr } = await owner.rpc('staff_place_order', {
      p_cafe_id: cafeId,
      p_order_type: 'dine_in',
      p_table_id: tbl!.id,
      p_items: [{ item_id: itemId, qty: 1 }],
      p_payment_method: 'cash',
      p_settle: true,
    })
    expect(sellErr, sellErr?.message).toBeNull()

    const { data: pays } = await admin.from('payments').select('id, session_id').eq('cafe_id', cafeId)
    expect(
      (pays ?? []).some((p) => p.session_id),
      'a settled dine-in order must produce a payment carrying a session_id, or this test proves nothing',
    ).toBe(true)

    const { error } = await admin.from('cafe_tables').delete().eq('id', tbl!.id)
    expect(error, 'deleting a used table must still work').toBeNull()
  })

  it('the escape hatch is not reachable through the API', { timeout: 40000 }, async () => {
    // `set local app.allow_financial_delete` needs a real SQL session. PostgREST
    // gives no way to set it, which is the point: a deliberate deletion has to
    // be a deliberate act at a psql prompt, not something a stray script or a
    // mis-click in a table editor can do.
    const orderId = await sellOne()
    const { error } = await admin.rpc('set_config', {
      setting_name: 'app.allow_financial_delete', new_value: 'on', is_local: false,
    })
    // Either the RPC does not exist (expected — nothing exposes it), or it did
    // nothing useful. Either way the delete must still be refused.
    void error
    const { error: delErr } = await admin.from('orders').delete().eq('id', orderId)
    expect(delErr, 'the guard must hold regardless').not.toBeNull()
  })
})
