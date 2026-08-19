// Regression tests for the inventory double-restock bug fixed in migration
// 0144: reverse_stock_for_cancelled_order had no idempotency guard, so any
// path that could invoke it twice for the same order (a genuine concurrent
// cancel_order race, or a client retry) double-credited inventory_items.
// current_stock. Fixed with orders.stock_reversed_at as an atomic claim —
// see 0144's own header comment for the full mechanism.
//
// Needs SUPABASE_SERVICE_ROLE_KEY locally to create/tear down a throwaway
// café fixture; skips (not fails) without it, same convention as
// race-conditions.test.ts. Also needs migrations through 0144 to be live —
// without them this suite fails on a missing column/old function behavior
// rather than skipping, which is the correct signal that the migration
// batch still needs to be run.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) throw new Error('NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY not set (need .env.local)')

const hasAdmin = Boolean(URL && KEY && SERVICE_KEY)

describe.skipIf(!hasAdmin)('inventory reversal idempotency regression guard (live)', () => {
  let admin: SupabaseClient
  let owner: SupabaseClient
  let cafeId: string
  let ownerUserId: string
  let itemId: string
  let invItemId: string
  const RECIPE_QTY = 2 // units of stock this item's recipe consumes per order

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
      .insert({ owner_id: ownerUserId, slug: `test-inv-${Date.now()}`, name: 'Inventory reversal test café', auto_deduct_stock: true })
      .select('id').single()
    if (cafeErr || !cafe) throw new Error(`fixture: could not create test café — ${cafeErr?.message}`)
    cafeId = cafe.id

    const { error: memberErr } = await admin
      .from('cafe_members')
      .insert({ cafe_id: cafeId, user_id: ownerUserId, role: 'owner' })
    if (memberErr) throw new Error(`fixture: could not add owner membership — ${memberErr.message}`)

    owner = createClient(URL!, KEY, { auth: { persistSession: false } })
    const { data: session, error: signInErr } = await owner.auth.signInWithPassword({ email, password })
    if (signInErr || !session.session) throw new Error(`fixture: owner sign-in failed — ${signInErr?.message}`)

    const { data: invItem, error: invErr } = await admin
      .from('inventory_items').insert({ cafe_id: cafeId, name: 'Test bean stock', unit: 'g', current_stock: 1000, cost: 1 }).select('id').single()
    if (invErr || !invItem) throw new Error(`fixture: could not create inventory item — ${invErr?.message}`)
    invItemId = invItem.id

    const { data: item, error: itemErr } = await admin
      .from('menu_items').insert({ cafe_id: cafeId, name: 'Test Coffee', price: 100, available: true }).select('id').single()
    if (itemErr || !item) throw new Error(`fixture: could not create menu item — ${itemErr?.message}`)
    itemId = item.id

    const { error: recipeErr } = await admin
      .from('recipe_items').insert({ cafe_id: cafeId, menu_item_id: itemId, inventory_item_id: invItemId, qty: RECIPE_QTY })
    if (recipeErr) throw new Error(`fixture: could not create recipe link — ${recipeErr.message}`)
  })

  afterAll(async () => {
    if (cafeId) await admin.from('cafes').delete().eq('id', cafeId)
    if (ownerUserId) await admin.auth.admin.deleteUser(ownerUserId)
  })

  async function stockNow(): Promise<number> {
    const { data } = await admin.from('inventory_items').select('current_stock').eq('id', invItemId).single()
    return data?.current_stock as number
  }

  it('cancel-before-prep restores exactly the deducted stock, once', { timeout: 30000 }, async () => {
    const before = await stockNow()

    const { data: order, error: placeErr } = await owner.rpc('staff_place_order', {
      p_cafe_id: cafeId,
      p_items: [{ item_id: itemId, qty: 1 }],
      p_order_type: 'takeaway',
    })
    if (placeErr || !order) throw new Error(`fixture: could not place order — ${placeErr?.message}`)

    const afterDeduct = await stockNow()
    expect(afterDeduct, 'placing the order must deduct the recipe quantity').toBe(before - RECIPE_QTY)

    const { error: cancelErr } = await owner.rpc('cancel_order', {
      p_order_id: order.order_id, p_reason: 'test cancellation',
    })
    expect(cancelErr, 'a normal single cancellation must succeed').toBeNull()

    const afterCancel = await stockNow()
    expect(afterCancel, 'cancelling must restore stock to exactly its pre-order level').toBe(before)

    const { data: reversalRows } = await admin
      .from('inventory_transactions')
      .select('id')
      .eq('cafe_id', cafeId)
      .eq('item_id', invItemId)
      .ilike('reason', `%${order.short_code}%cancelled — stock restored%`)
    expect((reversalRows ?? []).length, 'exactly one reversal ledger row for this cancellation').toBe(1)
  })

  it('two concurrent cancel_order calls for the same order restock only once', { timeout: 30000 }, async () => {
    const before = await stockNow()

    const { data: order, error: placeErr } = await owner.rpc('staff_place_order', {
      p_cafe_id: cafeId,
      p_items: [{ item_id: itemId, qty: 1 }],
      p_order_type: 'takeaway',
    })
    if (placeErr || !order) throw new Error(`fixture: could not place order — ${placeErr?.message}`)

    const afterDeduct = await stockNow()
    expect(afterDeduct).toBe(before - RECIPE_QTY)

    // A "high-water mark" read from the database's own clock, not the test
    // runner's — comparing a client-captured Date.now() against Supabase's
    // created_at is only as reliable as clock sync between the two, which
    // isn't guaranteed. Reading the latest existing row's own created_at
    // (or an epoch floor if none exist yet) and filtering strictly greater
    // than it after the race sidesteps clock skew entirely, and also avoids
    // the short_code-substring collision risk from the previous test's own
    // (already-cancelled) order in this same café — short_code excludes
    // cancelled orders from its count, so this order could easily reuse it.
    const { data: priorRows } = await admin
      .from('inventory_transactions')
      .select('created_at')
      .eq('cafe_id', cafeId)
      .eq('item_id', invItemId)
      .ilike('reason', '%cancelled — stock restored%')
      .order('created_at', { ascending: false })
      .limit(1)
    const priorHighWaterMark = priorRows?.[0]?.created_at ?? '1970-01-01T00:00:00Z'

    const attempt = () => owner.rpc('cancel_order', { p_order_id: order.order_id, p_reason: 'race test cancellation' })
    const [a, b] = await Promise.all([attempt(), attempt()])

    // cancel_order itself has no per-call uniqueness guard on the status
    // transition (only the earlier SELECT check, which both racers can pass
    // before either commits) — so BOTH calls may return success. The
    // regression this test guards is specifically that inventory is only
    // ever credited once regardless of how many times cancel_order itself
    // "succeeds".
    const bothErrored = a.error && b.error
    expect(bothErrored, 'at least one of the two concurrent cancels should be able to run to completion').toBeFalsy()

    const afterCancel = await stockNow()
    expect(afterCancel, 'a concurrent double-cancel must never restock the same order twice').toBe(before)

    const { data: reversalRows } = await admin
      .from('inventory_transactions')
      .select('id')
      .eq('cafe_id', cafeId)
      .eq('item_id', invItemId)
      .ilike('reason', '%cancelled — stock restored%')
      .gt('created_at', priorHighWaterMark)
    expect((reversalRows ?? []).length, 'exactly one reversal ledger row even under a concurrent double-cancel').toBe(1)

    const { data: orderRow } = await admin.from('orders').select('stock_reversed_at').eq('id', order.order_id).single()
    expect(orderRow?.stock_reversed_at, 'the idempotency claim must be set after cancellation').not.toBeNull()
  })

  it('a partially refunded order cannot reach cancel_order (payment_status stays paid)', { timeout: 30000 }, async () => {
    const { data: order, error: placeErr } = await owner.rpc('staff_place_order', {
      p_cafe_id: cafeId,
      p_items: [{ item_id: itemId, qty: 1 }],
      p_order_type: 'takeaway',
      p_payment_method: 'cash',
      p_settle: true,
    })
    if (placeErr || !order) throw new Error(`fixture: could not place + settle order — ${placeErr?.message}`)

    const { error: refundErr } = await owner.rpc('refund_order', {
      p_order_id: order.order_id, p_reason: 'test partial refund', p_amount: 1,
    })
    expect(refundErr, 'a small partial refund must succeed').toBeNull()

    const { error: cancelErr } = await owner.rpc('cancel_order', {
      p_order_id: order.order_id, p_reason: 'should be blocked',
    })
    expect(cancelErr, 'cancel_order must still refuse a partially-refunded (still "paid") order').not.toBeNull()
  })
})
