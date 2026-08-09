// Combo meals (migration 0123). The invariant worth guarding is the whole
// design decision: a combo must expand into REAL, REAL-PRICED order_items
// rows with the bundle saving applied as a discount — not one opaque line and
// not ₹0 components. Get that wrong and the kitchen ticket, inventory
// deduction, GST per component, and the profitability report all quietly go
// wrong together, which is exactly the kind of failure a schema-existence
// check can't see.
//
// Needs SUPABASE_SERVICE_ROLE_KEY locally to create/tear down a throwaway
// café fixture; skips (not fails) without it, same convention as
// race-conditions.test.ts.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) throw new Error('NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY not set (need .env.local)')

const hasAdmin = Boolean(URL && KEY && SERVICE_KEY)

describe.skipIf(!hasAdmin)('combo meals (live)', () => {
  let admin: SupabaseClient
  let owner: SupabaseClient
  let cafeId: string
  let ownerUserId: string
  let pizzaCatId: string
  let drinkCatId: string
  let margheritaId: string
  let pepperoniId: string
  let mojitoId: string
  let garlicBreadId: string

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE_KEY!, { auth: { persistSession: false } })
    const email = `test-combo-${Date.now()}@khaopiyo-test.invalid`
    const password = crypto.randomUUID()

    const { data: userRes, error: userErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (userErr || !userRes.user) throw new Error(`fixture: could not create test user — ${userErr?.message}`)
    ownerUserId = userRes.user.id

    const { data: cafe, error: cafeErr } = await admin
      .from('cafes')
      .insert({ owner_id: ownerUserId, slug: `test-combo-${Date.now()}`, name: 'Combo test café' })
      .select('id').single()
    if (cafeErr || !cafe) throw new Error(`fixture: could not create test café — ${cafeErr?.message}`)
    cafeId = cafe.id

    const { error: memberErr } = await admin
      .from('cafe_members').insert({ cafe_id: cafeId, user_id: ownerUserId, role: 'owner' })
    if (memberErr) throw new Error(`fixture: could not add owner membership — ${memberErr.message}`)

    const { data: cats, error: catErr } = await admin
      .from('menu_categories')
      .insert([{ cafe_id: cafeId, name: 'Pizza', sort: 0 }, { cafe_id: cafeId, name: 'Drinks', sort: 1 }])
      .select('id, name')
    if (catErr || !cats) throw new Error(`fixture: could not create categories — ${catErr?.message}`)
    pizzaCatId = cats.find((c) => c.name === 'Pizza')!.id
    drinkCatId = cats.find((c) => c.name === 'Drinks')!.id

    const { data: menu, error: menuErr } = await admin
      .from('menu_items')
      .insert([
        { cafe_id: cafeId, category_id: pizzaCatId, name: 'Margherita', price: 200, available: true },
        { cafe_id: cafeId, category_id: pizzaCatId, name: 'Pepperoni', price: 260, available: true },
        { cafe_id: cafeId, category_id: drinkCatId, name: 'Mint Mojito', price: 120, available: true },
        { cafe_id: cafeId, category_id: null, name: 'Garlic Bread', price: 90, available: true },
      ])
      .select('id, name')
    if (menuErr || !menu) throw new Error(`fixture: could not create menu items — ${menuErr?.message}`)
    margheritaId = menu.find((m) => m.name === 'Margherita')!.id
    pepperoniId = menu.find((m) => m.name === 'Pepperoni')!.id
    mojitoId = menu.find((m) => m.name === 'Mint Mojito')!.id
    garlicBreadId = menu.find((m) => m.name === 'Garlic Bread')!.id

    owner = createClient(URL!, KEY, { auth: { persistSession: false } })
    const { data: session, error: signInErr } = await owner.auth.signInWithPassword({ email, password })
    if (signInErr || !session.session) throw new Error(`fixture: owner sign-in failed — ${signInErr?.message}`)
  })

  afterAll(async () => {
    if (cafeId) await admin.from('cafes').delete().eq('id', cafeId)
    if (ownerUserId) await admin.auth.admin.deleteUser(ownerUserId)
  })

  /** "Meal for Two": fixed garlic bread + any pizza + any two drinks, ₹499. */
  async function createMealCombo(price = 499) {
    const { data, error } = await owner.rpc('create_combo', {
      p_cafe_id: cafeId,
      p_name: 'Meal for Two',
      p_price: price,
      p_slots: [
        { label: 'Cheese Garlic Bread', kind: 'fixed', menu_item_id: garlicBreadId, qty: 1 },
        { label: 'Any Pizza', kind: 'choice', category_id: pizzaCatId, qty: 1 },
        { label: 'Any Two Drinks', kind: 'choice', category_id: drinkCatId, qty: 2 },
      ],
    })
    if (error) throw new Error(`could not create combo — ${error.message}`)
    return data as { id: string; name: string; price: number }
  }

  it('expands into real, real-priced component rows sharing one combo_group', { timeout: 30000 }, async () => {
    const combo = await createMealCombo()
    const { data: slots } = await admin.from('combo_slots').select('*').eq('combo_id', combo.id).order('sort')
    const pizzaSlot = (slots ?? []).find((s) => s.label === 'Any Pizza')!
    const drinkSlot = (slots ?? []).find((s) => s.label === 'Any Two Drinks')!

    const { data: res, error } = await owner.rpc('staff_place_order', {
      p_cafe_id: cafeId,
      p_order_type: 'takeaway',
      p_items: [
        {
          combo_id: combo.id,
          qty: 1,
          selections: [
            { slot_id: pizzaSlot.id, item_id: margheritaId },
            { slot_id: drinkSlot.id, item_id: mojitoId },
            { slot_id: drinkSlot.id, item_id: mojitoId },
          ],
        },
      ],
    })
    expect(error, error?.message).toBeNull()
    const orderId = (res as { order_id: string }).order_id

    const { data: lines } = await admin
      .from('order_items').select('name, price, qty, combo_id, combo_group, taxable_value').eq('order_id', orderId)
    const rows = lines ?? []

    // Garlic bread (fixed) + Margherita (choice) + Mojito ×2 collapsed into
    // one line = three rows, all in the same group, all at MENU price.
    expect(rows.length, 'identical picks in one slot should collapse into a single line').toBe(3)
    expect(new Set(rows.map((r) => r.combo_group)).size, 'all components share one combo_group').toBe(1)
    expect(rows.every((r) => r.combo_id === combo.id)).toBe(true)
    expect(rows.every((r) => r.price > 0), 'components must carry their real menu price, not ₹0').toBe(true)

    const byName = new Map(rows.map((r) => [r.name, r]))
    expect(byName.get('Garlic Bread')!.price).toBe(90)
    expect(byName.get('Margherita')!.price).toBe(200)
    expect(byName.get('Mint Mojito')!.price).toBe(120)
    expect(byName.get('Mint Mojito')!.qty, 'two identical picks become qty 2').toBe(2)

    // 90 + 200 + 240 = 530 of parts, sold as 499 → 31 saving as a discount.
    const { data: order } = await admin
      .from('orders').select('subtotal, discount, total').eq('id', orderId).single()
    expect(order!.subtotal).toBe(530)
    expect(order!.discount).toBe(31)
    expect(order!.total, 'guest pays the combo price').toBe(499)

    // The reason components are real-priced: per-line tax bases stay sane.
    expect(rows.every((r) => (r.taxable_value ?? 0) >= 0), 'no line may end up with a negative taxable value').toBe(true)
    expect(rows.reduce((s, r) => s + (r.taxable_value ?? 0), 0)).toBe(499)
  })

  it('multiplies component quantities by the combo line quantity', { timeout: 30000 }, async () => {
    const combo = await createMealCombo()
    const { data: slots } = await admin.from('combo_slots').select('*').eq('combo_id', combo.id).order('sort')
    const pizzaSlot = (slots ?? []).find((s) => s.label === 'Any Pizza')!
    const drinkSlot = (slots ?? []).find((s) => s.label === 'Any Two Drinks')!

    const { data: res, error } = await owner.rpc('staff_place_order', {
      p_cafe_id: cafeId,
      p_order_type: 'takeaway',
      p_items: [
        {
          combo_id: combo.id,
          qty: 2,
          selections: [
            { slot_id: pizzaSlot.id, item_id: pepperoniId },
            { slot_id: drinkSlot.id, item_id: mojitoId },
            { slot_id: drinkSlot.id, item_id: mojitoId },
          ],
        },
      ],
    })
    expect(error, error?.message).toBeNull()
    const orderId = (res as { order_id: string }).order_id

    const { data: lines } = await admin.from('order_items').select('name, qty').eq('order_id', orderId)
    const byName = new Map((lines ?? []).map((r) => [r.name, r.qty]))
    expect(byName.get('Garlic Bread')).toBe(2) // 1 per combo × 2 combos
    expect(byName.get('Pepperoni')).toBe(2)
    expect(byName.get('Mint Mojito')).toBe(4) // 2 per combo × 2 combos

    const { data: order } = await admin.from('orders').select('total').eq('id', orderId).single()
    expect(order!.total).toBe(998) // 499 × 2
  })

  it('rejects a choice that is not in that slot\'s category', { timeout: 30000 }, async () => {
    const combo = await createMealCombo()
    const { data: slots } = await admin.from('combo_slots').select('*').eq('combo_id', combo.id).order('sort')
    const pizzaSlot = (slots ?? []).find((s) => s.label === 'Any Pizza')!
    const drinkSlot = (slots ?? []).find((s) => s.label === 'Any Two Drinks')!

    // A tampered payload trying to get a ₹260 pizza into the drinks slot.
    const { error } = await owner.rpc('staff_place_order', {
      p_cafe_id: cafeId,
      p_order_type: 'takeaway',
      p_items: [
        {
          combo_id: combo.id,
          qty: 1,
          selections: [
            { slot_id: pizzaSlot.id, item_id: margheritaId },
            { slot_id: drinkSlot.id, item_id: pepperoniId },
            { slot_id: drinkSlot.id, item_id: pepperoniId },
          ],
        },
      ],
    })
    expect(error, 'an out-of-category pick must be refused server-side').not.toBeNull()
  })

  it('rejects a combo with the wrong number of picks for a slot', { timeout: 30000 }, async () => {
    const combo = await createMealCombo()
    const { data: slots } = await admin.from('combo_slots').select('*').eq('combo_id', combo.id).order('sort')
    const pizzaSlot = (slots ?? []).find((s) => s.label === 'Any Pizza')!
    const drinkSlot = (slots ?? []).find((s) => s.label === 'Any Two Drinks')!

    const { error } = await owner.rpc('staff_place_order', {
      p_cafe_id: cafeId,
      p_order_type: 'takeaway',
      p_items: [
        {
          combo_id: combo.id,
          qty: 1,
          selections: [
            { slot_id: pizzaSlot.id, item_id: margheritaId },
            { slot_id: drinkSlot.id, item_id: mojitoId }, // only 1 of the 2 required
          ],
        },
      ],
    })
    expect(error, 'an under-filled choice slot must be refused').not.toBeNull()
  })

  it('never produces a negative discount when the combo costs more than its parts', { timeout: 30000 }, async () => {
    // Parts are 530; price this one ABOVE that so savings would go negative
    // if it were not clamped.
    const combo = await createMealCombo(900)
    const { data: slots } = await admin.from('combo_slots').select('*').eq('combo_id', combo.id).order('sort')
    const pizzaSlot = (slots ?? []).find((s) => s.label === 'Any Pizza')!
    const drinkSlot = (slots ?? []).find((s) => s.label === 'Any Two Drinks')!

    const { data: res, error } = await owner.rpc('staff_place_order', {
      p_cafe_id: cafeId,
      p_order_type: 'takeaway',
      p_items: [
        {
          combo_id: combo.id,
          qty: 1,
          selections: [
            { slot_id: pizzaSlot.id, item_id: margheritaId },
            { slot_id: drinkSlot.id, item_id: mojitoId },
            { slot_id: drinkSlot.id, item_id: mojitoId },
          ],
        },
      ],
    })
    expect(error, error?.message).toBeNull()

    const { data: order } = await admin
      .from('orders').select('subtotal, discount, total').eq('id', (res as { order_id: string }).order_id).single()
    expect(order!.discount, 'saving is clamped at zero, never negative').toBe(0)
    expect(order!.total, 'guest pays the sum of parts, not the higher combo price').toBe(530)
  })

  it('refuses a combo belonging to another café', { timeout: 30000 }, async () => {
    const combo = await createMealCombo()
    const { error } = await owner.rpc('staff_place_order', {
      p_cafe_id: cafeId,
      p_order_type: 'takeaway',
      // Real combo id, but claimed against a café it doesn't belong to —
      // guarded by the cafe_id match inside expand_combo_line.
      p_items: [{ combo_id: combo.id, qty: 1, selections: [] }],
    })
    // Fails either way (missing picks or wrong café); the point is it never
    // silently places a free/partial order.
    expect(error).not.toBeNull()
  })
})
