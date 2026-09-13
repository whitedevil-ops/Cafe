// Regression test for the HIGH-severity finding from the 2026-09-13 final
// production-readiness pass: deleting a menu item cascades away its
// combo_slots row with no warning; if every slot of a combo is eventually
// removed this way, the combo stays active and purchasable but
// expand_combo_line silently completes the sale with zero order_items and
// zero discount — the guest is charged nothing and the kitchen gets
// nothing, while believing they ordered something real. Fixed in migration
// 0243 by rejecting the sale outright when a combo has zero remaining slots.
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

describe.skipIf(!hasAdmin)('expand_combo_line rejects an emptied-out combo (live)', () => {
  let admin: SupabaseClient
  let owner: SupabaseClient
  let cafeId: string
  let ownerUserId: string

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE_KEY!, { auth: { persistSession: false } })
    const email = `test-comboempty-${Date.now()}@khaopiyo-test.invalid`
    const password = crypto.randomUUID()

    const { data: userRes, error: userErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (userErr || !userRes.user) throw new Error(`fixture: could not create test user — ${userErr?.message}`)
    ownerUserId = userRes.user.id

    const { data: cafe, error: cafeErr } = await admin
      .from('cafes').insert({ owner_id: ownerUserId, slug: `test-comboempty-${Date.now()}`, name: 'Empty combo test' }).select('id').single()
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

  it('a combo with zero remaining slots (all components deleted) cannot be sold', async () => {
    const { data: item, error: itemErr } = await admin
      .from('menu_items').insert({ cafe_id: cafeId, name: 'Combo Component', price: 100, available: true }).select('id').single()
    if (itemErr || !item) throw new Error(`fixture: could not create menu item — ${itemErr?.message}`)

    const { data: combo, error: comboErr } = await admin
      .from('combos').insert({ cafe_id: cafeId, name: 'Ghost Combo', price: 199, active: true }).select('id').single()
    if (comboErr || !combo) throw new Error(`fixture: could not create combo — ${comboErr?.message}`)

    const { error: slotErr } = await admin
      .from('combo_slots').insert({ combo_id: combo.id, label: 'Component', kind: 'fixed', menu_item_id: item.id, qty: 1 })
    if (slotErr) throw new Error(`fixture: could not create combo slot — ${slotErr.message}`)

    // Deleting the item cascade-deletes the slot, leaving the combo with
    // zero components — exactly the real-world sequence this guards against.
    const { error: delErr } = await admin.from('menu_items').delete().eq('id', item.id)
    if (delErr) throw new Error(`fixture: could not delete the combo's component item — ${delErr.message}`)

    const { data: remaining } = await admin.from('combo_slots').select('id').eq('combo_id', combo.id)
    expect(remaining ?? [], 'fixture setup failed: the slot was not actually cascade-deleted').toHaveLength(0)

    const { error: sellErr } = await owner.rpc('staff_place_order', {
      p_cafe_id: cafeId,
      p_order_type: 'takeaway',
      p_items: [{ combo_id: combo.id, selections: [], qty: 1 }],
    })
    expect(sellErr?.message ?? '', 'expected the sale of an emptied combo to be rejected').toMatch(/no items configured/i)
  })
})
