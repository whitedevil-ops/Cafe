// The one gap the original security-boundaries.test.ts explicitly flagged in
// its own comments: every other test proves anon can't reach sensitive data,
// but nothing had ever proven CAFÉ A CANNOT REACH CAFÉ B'S DATA using a real,
// authenticated, legitimate JWT — the actual cross-tenant attack this whole
// architecture (is_cafe_member(cafe_id) on every policy) is built to stop.
//
// Creates two real throwaway cafés with two real owners, places a real order
// in café A, then — authenticated as café B's owner, a genuine authenticated
// user with real table-write grants, just for the WRONG café — attempts to
// read and write café A's data. Needs SUPABASE_SERVICE_ROLE_KEY locally to
// build the fixture; skips (not fails) without it, same convention as the
// other integration suites.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) throw new Error('NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY not set (need .env.local)')

const hasAdmin = Boolean(URL && KEY && SERVICE_KEY)

describe.skipIf(!hasAdmin)('two-tenant cross-isolation (live)', () => {
  let admin: SupabaseClient
  let cafeAId: string
  let cafeBId: string
  let ownerBClient: SupabaseClient
  let cafeAOrderId: string
  let cafeAUserId: string
  let cafeBUserId: string

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE_KEY!, { auth: { persistSession: false } })

    async function makeCafe(label: string) {
      const email = `test-${label}-${Date.now()}@khaopiyo-test.invalid`
      const password = crypto.randomUUID()
      const { data: userRes, error: userErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
      if (userErr || !userRes.user) throw new Error(`fixture: could not create ${label} user — ${userErr?.message}`)
      const { data: cafe, error: cafeErr } = await admin
        .from('cafes')
        .insert({ owner_id: userRes.user.id, slug: `test-${label}-${Date.now()}`, name: `Isolation test ${label}` })
        .select('id').single()
      if (cafeErr || !cafe) throw new Error(`fixture: could not create ${label} café — ${cafeErr?.message}`)
      const client = createClient(URL!, KEY!, { auth: { persistSession: false } })
      const { error: signInErr } = await client.auth.signInWithPassword({ email, password })
      if (signInErr) throw new Error(`fixture: ${label} sign-in failed — ${signInErr.message}`)
      return { userId: userRes.user.id, cafeId: cafe.id as string, client }
    }

    const a = await makeCafe('a')
    const b = await makeCafe('b')
    cafeAUserId = a.userId
    cafeAId = a.cafeId
    cafeBUserId = b.userId
    cafeBId = b.cafeId
    ownerBClient = b.client

    const { data: item, error: itemErr } = await admin
      .from('menu_items').insert({ cafe_id: cafeAId, name: 'Isolation Item', price: 100, available: true }).select('id').single()
    if (itemErr || !item) throw new Error(`fixture: could not create café A menu item — ${itemErr?.message}`)

    const { data: order, error: orderErr } = await a.client.rpc('staff_place_order', {
      p_cafe_id: cafeAId,
      p_items: [{ item_id: item.id, qty: 1 }],
      p_order_type: 'takeaway',
    })
    if (orderErr || !order) throw new Error(`fixture: could not place café A order — ${orderErr?.message}`)
    cafeAOrderId = (order as { order_id: string }).order_id
  })

  afterAll(async () => {
    if (cafeAId) await admin.from('cafes').delete().eq('id', cafeAId)
    if (cafeBId) await admin.from('cafes').delete().eq('id', cafeBId)
    if (cafeAUserId) await admin.auth.admin.deleteUser(cafeAUserId)
    if (cafeBUserId) await admin.auth.admin.deleteUser(cafeBUserId)
  })

  it('café B cannot SELECT café A orders by filtering on cafe_id', async () => {
    const { data } = await ownerBClient.from('orders').select('id').eq('cafe_id', cafeAId)
    expect(data ?? [], 'café B read a row belonging to café A').toHaveLength(0)
  })

  it('café B cannot SELECT café A customers', async () => {
    const { data } = await ownerBClient.from('customers').select('id').eq('cafe_id', cafeAId)
    expect(data ?? [], 'café B read a customer row belonging to café A').toHaveLength(0)
  })

  it('café B\'s owner cannot PATCH an order that belongs to café A', async () => {
    const { error, data } = await ownerBClient
      .from('orders')
      .update({ status: 'done' })
      .eq('id', cafeAOrderId)
      .select('id')
    // A genuine, legitimately-authenticated owner — just of the wrong café.
    // RLS must block this via is_cafe_member(cafe_id), not the table grant
    // (which they legitimately hold for their OWN café).
    expect(data ?? [], 'café B modified an order belonging to café A').toHaveLength(0)
    void error
  })

  it('bill_detail rejects a café A order id when called as café B\'s owner', async () => {
    const { error } = await ownerBClient.rpc('bill_detail', { p_order_id: cafeAOrderId })
    expect(error, 'bill_detail returned café A data to café B').toBeTruthy()
  })

  it('staff_place_order rejects café A\'s cafe_id when called as café B\'s owner', async () => {
    const { error } = await ownerBClient.rpc('staff_place_order', {
      p_cafe_id: cafeAId,
      p_items: [{ item_id: '00000000-0000-0000-0000-000000000000', qty: 1 }],
      p_order_type: 'takeaway',
    })
    expect(error?.message ?? '', 'expected a not-authorized rejection').toMatch(/not authorized/i)
  })

  it('café B cannot enumerate café A via cafe_has_feature probing', async () => {
    const { data, error } = await ownerBClient.rpc('cafe_has_feature', { p_cafe_id: cafeAId, p_feature: 'inventory' })
    // Fails closed to `false` for a non-member rather than erroring or leaking
    // the real value — matches cafe_has_feature's own documented behavior.
    expect(error).toBeFalsy()
    expect(data).toBe(false)
  })
})
