// Regression test for the HIGH-severity finding from the 2026-09-13 final
// production-readiness pass: record_payment had no check for a cancelled
// order, so a payment landing after cancellation became a real collected-
// money row that was invisible to every report and unrefundable through the
// app. Fixed in migration 0242.
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

describe.skipIf(!hasAdmin)('record_payment rejects a cancelled order (live)', () => {
  let admin: SupabaseClient
  let owner: SupabaseClient
  let cafeId: string
  let ownerUserId: string

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE_KEY!, { auth: { persistSession: false } })
    const email = `test-rpco-${Date.now()}@khaopiyo-test.invalid`
    const password = crypto.randomUUID()

    const { data: userRes, error: userErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (userErr || !userRes.user) throw new Error(`fixture: could not create test user — ${userErr?.message}`)
    ownerUserId = userRes.user.id

    const { data: cafe, error: cafeErr } = await admin
      .from('cafes').insert({ owner_id: ownerUserId, slug: `test-rpco-${Date.now()}`, name: 'record_payment cancel test' }).select('id').single()
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

  it('a payment against an already-cancelled order is rejected, not silently orphaned', async () => {
    const { data: item, error: itemErr } = await admin
      .from('menu_items').insert({ cafe_id: cafeId, name: 'Cancel Test Item', price: 250, available: true }).select('id').single()
    if (itemErr || !item) throw new Error(`fixture: could not create menu item — ${itemErr?.message}`)

    // Place an UNPAID order (no p_settle) so it can be cancelled cleanly.
    const { data: placed, error: placeErr } = await owner.rpc('staff_place_order', {
      p_cafe_id: cafeId,
      p_order_type: 'takeaway',
      p_items: [{ item_id: item.id, qty: 1 }],
    })
    if (placeErr || !placed) throw new Error(`fixture: could not place order — ${placeErr?.message}`)
    const orderId = (placed as { order_id: string }).order_id

    const { error: cancelErr } = await owner.rpc('cancel_order', { p_order_id: orderId, p_reason: 'kitchen ran out' })
    expect(cancelErr, cancelErr?.message).toBeNull()

    const { error: payErr } = await owner.rpc('record_payment', {
      p_order_id: orderId, p_amount: 250, p_method: 'cash',
    })
    expect(payErr?.message ?? '', 'expected record_payment to reject a cancelled order').toMatch(/cancelled/i)

    const { data: payments } = await admin.from('payments').select('id').eq('order_id', orderId)
    expect(payments ?? [], 'a payment row was created against a cancelled order').toHaveLength(0)
  })
})
