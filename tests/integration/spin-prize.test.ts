// Claiming a spin prize at the till (migration 0126).
//
// The invariant worth guarding is the reason 0126 exists at all: a won prize
// is the café's promise, not the cashier's discretion, so it must apply ABOVE
// the role discount cap — while still being spent exactly once, and only
// against a bill that actually contains the thing that was won. None of that
// is visible to a schema-existence check; all of it is visible to a waiter on
// a Friday night.
//
// Needs SUPABASE_SERVICE_ROLE_KEY locally to create/tear down a throwaway café
// fixture; skips (not fails) without it, same convention as combos.test.ts.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) throw new Error('NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY not set (need .env.local)')

const hasAdmin = Boolean(URL && KEY && SERVICE_KEY)

const COLD_COFFEE = 150
const SANDWICH = 100
const EXTRA_SHOT = 40

describe.skipIf(!hasAdmin)('spin prize at the till (live)', () => {
  let admin: SupabaseClient
  let owner: SupabaseClient
  let waiter: SupabaseClient
  let anon: SupabaseClient
  let cafeId: string
  let ownerUserId: string
  let waiterUserId: string
  let coldCoffeeId: string
  let sandwichId: string
  let extraShotId: string

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE_KEY!, { auth: { persistSession: false } })
    anon = createClient(URL!, KEY, { auth: { persistSession: false } })

    const stamp = Date.now()
    const ownerEmail = `test-spin-owner-${stamp}@khaopiyo-test.invalid`
    const waiterEmail = `test-spin-waiter-${stamp}@khaopiyo-test.invalid`
    const ownerPass = crypto.randomUUID()
    const waiterPass = crypto.randomUUID()

    const { data: o, error: oErr } = await admin.auth.admin.createUser({ email: ownerEmail, password: ownerPass, email_confirm: true })
    if (oErr || !o.user) throw new Error(`fixture: could not create owner — ${oErr?.message}`)
    ownerUserId = o.user.id

    const { data: w, error: wErr } = await admin.auth.admin.createUser({ email: waiterEmail, password: waiterPass, email_confirm: true })
    if (wErr || !w.user) throw new Error(`fixture: could not create waiter — ${wErr?.message}`)
    waiterUserId = w.user.id

    const { data: cafe, error: cafeErr } = await admin
      .from('cafes')
      // plan: 'business' — spin_the_wheel/redeem_spin_prize/save_spin_wheel are
      // gated behind the 'loyalty' feature (migration 0143); the default
      // 'trial' plan has it off, which would fail every RPC call below before
      // ever reaching the scenario under test.
      .insert({ owner_id: ownerUserId, slug: `test-spin-${stamp}`, name: 'Spin test café', plan: 'business' })
      .select('id').single()
    if (cafeErr || !cafe) throw new Error(`fixture: could not create café — ${cafeErr?.message}`)
    cafeId = cafe.id

    const { error: memErr } = await admin.from('cafe_members').insert([
      { cafe_id: cafeId, user_id: ownerUserId, role: 'owner' },
      { cafe_id: cafeId, user_id: waiterUserId, role: 'waiter' },
    ])
    if (memErr) throw new Error(`fixture: could not add memberships — ${memErr.message}`)

    const { data: menu, error: menuErr } = await admin
      .from('menu_items')
      .insert([
        { cafe_id: cafeId, name: 'Cold Coffee', price: COLD_COFFEE, available: true },
        { cafe_id: cafeId, name: 'Sandwich', price: SANDWICH, available: true },
      ])
      .select('id, name')
    if (menuErr || !menu) throw new Error(`fixture: could not create menu — ${menuErr?.message}`)
    coldCoffeeId = menu.find((m) => m.name === 'Cold Coffee')!.id
    sandwichId = menu.find((m) => m.name === 'Sandwich')!.id

    const { data: addon, error: addonErr } = await admin
      .from('menu_item_addons')
      .insert({ menu_item_id: coldCoffeeId, name: 'Extra shot', price: EXTRA_SHOT })
      .select('id').single()
    if (addonErr || !addon) throw new Error(`fixture: could not create add-on — ${addonErr?.message}`)
    extraShotId = addon.id

    owner = createClient(URL!, KEY, { auth: { persistSession: false } })
    const { error: sErr } = await owner.auth.signInWithPassword({ email: ownerEmail, password: ownerPass })
    if (sErr) throw new Error(`fixture: owner sign-in failed — ${sErr.message}`)

    waiter = createClient(URL!, KEY, { auth: { persistSession: false } })
    const { error: swErr } = await waiter.auth.signInWithPassword({ email: waiterEmail, password: waiterPass })
    if (swErr) throw new Error(`fixture: waiter sign-in failed — ${swErr.message}`)

    // One slice only, so the draw is deterministic: whoever spins wins a free
    // Cold Coffee.
    const { error: wheelErr } = await owner.rpc('save_spin_wheel', {
      p_cafe_id: cafeId,
      p_title: 'Spin & win',
      p_subtitle: null,
      p_active: true,
      p_expiry_days: 7,
      p_min_order_amount: 0,
      p_enable_confetti: true,
      p_enable_sound: true,
      p_segments: [{ label: 'Free Cold Coffee', kind: 'item', menu_item_id: coldCoffeeId, value: 0, weight: 1 }],
    })
    if (wheelErr) throw new Error(`fixture: could not save wheel — ${wheelErr.message}`)
  })

  afterAll(async () => {
    if (cafeId) await admin.from('cafes').delete().eq('id', cafeId)
    if (ownerUserId) await admin.auth.admin.deleteUser(ownerUserId)
    if (waiterUserId) await admin.auth.admin.deleteUser(waiterUserId)
  })

  /** Sell something, settle it, and spin — returns the guest's claim code. */
  async function winACode(): Promise<string> {
    const { data: res, error } = await owner.rpc('staff_place_order', {
      p_cafe_id: cafeId,
      p_order_type: 'takeaway',
      p_items: [{ item_id: sandwichId, qty: 1 }],
      p_payment_method: 'cash',
      p_settle: true,
    })
    if (error) throw new Error(`fixture: could not sell a bill to spin on — ${error.message}`)
    const token = (res as { receipt_token: string }).receipt_token

    const { data: prize, error: spinErr } = await anon.rpc('spin_the_wheel', { p_receipt_token: token })
    if (spinErr) throw new Error(`fixture: spin failed — ${spinErr.message}`)
    return (prize as { code: string }).code
  }

  async function orderCount(): Promise<number> {
    const { count } = await admin.from('orders').select('id', { count: 'exact', head: true }).eq('cafe_id', cafeId)
    return count ?? 0
  }

  it('lets a waiter honour a prize far beyond their own discount cap', { timeout: 40000 }, async () => {
    const code = await winACode()

    // ₹250 bill, ₹150 given away = 60% off. A waiter is capped at 5%, so if
    // the prize went through the staff-discount channel this would be refused.
    const { data: res, error } = await waiter.rpc('staff_place_order', {
      p_cafe_id: cafeId,
      p_order_type: 'takeaway',
      p_items: [{ item_id: coldCoffeeId, qty: 1 }, { item_id: sandwichId, qty: 1 }],
      p_spin_code: code,
    })
    expect(error, error?.message).toBeNull()

    const orderId = (res as { order_id: string }).order_id
    const { data: order } = await admin.from('orders').select('subtotal, discount, total').eq('id', orderId).single()
    expect(order!.subtotal).toBe(COLD_COFFEE + SANDWICH)
    expect(order!.discount, 'the whole price of the won item comes off').toBe(COLD_COFFEE)
    expect(order!.total, 'guest pays for the sandwich only').toBe(SANDWICH)

    // The won drink is a real line, so the kitchen makes it and stock deducts.
    const { data: lines } = await admin.from('order_items').select('name, price').eq('order_id', orderId)
    const coffee = (lines ?? []).find((l) => l.name === 'Cold Coffee')
    expect(coffee, 'the won item stays on the ticket').toBeTruthy()
    expect(coffee!.price, 'at its real price, not ₹0').toBe(COLD_COFFEE)

    // And the claim is recorded against the bill it paid for.
    const { data: result } = await admin
      .from('spin_results').select('redeemed_at, redeemed_order_id').eq('code', code).single()
    expect(result!.redeemed_at).not.toBeNull()
    expect(result!.redeemed_order_id).toBe(orderId)
  })

  it('discounts the dearest matching line', { timeout: 40000 }, async () => {
    const code = await winACode()

    // Two coffees on the bill: one plain (₹150), one with an extra shot
    // (₹190). Winning "a free Cold Coffee" should give away the better one.
    const { data: res, error } = await waiter.rpc('staff_place_order', {
      p_cafe_id: cafeId,
      p_order_type: 'takeaway',
      p_items: [
        { item_id: coldCoffeeId, qty: 1 },
        { item_id: coldCoffeeId, qty: 1, addon_ids: [extraShotId] },
      ],
      p_spin_code: code,
    })
    expect(error, error?.message).toBeNull()

    const orderId = (res as { order_id: string }).order_id
    const { data: order } = await admin.from('orders').select('subtotal, discount, total').eq('id', orderId).single()
    expect(order!.subtotal).toBe(COLD_COFFEE + COLD_COFFEE + EXTRA_SHOT)
    expect(order!.discount, 'the dearer of the two matching lines').toBe(COLD_COFFEE + EXTRA_SHOT)
  })

  it('refuses a free-item claim when the item is not on the bill, leaving no order behind', { timeout: 40000 }, async () => {
    const code = await winACode()
    const before = await orderCount()

    const { error } = await waiter.rpc('staff_place_order', {
      p_cafe_id: cafeId,
      p_order_type: 'takeaway',
      p_items: [{ item_id: sandwichId, qty: 1 }],
      p_spin_code: code,
    })
    expect(error, 'a free coffee cannot be given away on a bill with no coffee').not.toBeNull()
    expect(error!.message).toMatch(/add .* to the bill/i)

    // The whole order must roll back — no half-placed bill, and the prize is
    // still the guest's to use.
    expect(await orderCount(), 'the refused order must not survive').toBe(before)
    const { data: result } = await admin.from('spin_results').select('redeemed_at').eq('code', code).single()
    expect(result!.redeemed_at, 'a refused claim must not spend the prize').toBeNull()
  })

  it('cannot be claimed twice', { timeout: 40000 }, async () => {
    const code = await winACode()

    const first = await waiter.rpc('staff_place_order', {
      p_cafe_id: cafeId,
      p_order_type: 'takeaway',
      p_items: [{ item_id: coldCoffeeId, qty: 1 }],
      p_spin_code: code,
    })
    expect(first.error, first.error?.message).toBeNull()

    const before = await orderCount()
    const second = await waiter.rpc('staff_place_order', {
      p_cafe_id: cafeId,
      p_order_type: 'takeaway',
      p_items: [{ item_id: coldCoffeeId, qty: 1 }],
      p_spin_code: code,
    })
    expect(second.error, 'the second till must not get the same prize').not.toBeNull()
    expect(second.error!.message).toMatch(/already been claimed/i)
    expect(await orderCount(), 'and its order must roll back entirely').toBe(before)
  })

  it('still refuses a discount above the role cap when no prize is involved', { timeout: 40000 }, async () => {
    // The prize channel must not have widened what a waiter can do by hand.
    const { error } = await waiter.rpc('staff_place_order', {
      p_cafe_id: cafeId,
      p_order_type: 'takeaway',
      p_items: [{ item_id: coldCoffeeId, qty: 1 }],
      p_discount_type: 'percent',
      p_discount_value: 50,
    })
    expect(error, 'a waiter still cannot hand out 50% on their own').not.toBeNull()
    expect(error!.message).toMatch(/at most/i)
  })
})
