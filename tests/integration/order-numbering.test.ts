// Regression tests for the duplicate bill number incident (FEAR & FEAST,
// 02 Sept 2026): two different orders were handed the same short_code twice
// in one morning — once because cancelling an order freed its number for
// reuse, once because count(*)+1 raced two simultaneous orders to the same
// total. Migration 0203 replaced the recount with an atomic per-café,
// per-business-day counter (order_number_counters + next_order_short_code()).
//
// These hit the live database on purpose. The entire fix is a row lock and an
// INSERT ... ON CONFLICT DO UPDATE — behaviour that exists only inside
// Postgres. A test that read the SQL and looked for 'next_order_short_code'
// would pass just as happily against a counter that reissued numbers, which
// is precisely the regression this file has to catch. A bill number that
// identifies two different sales is an accounting problem, so it gets the
// same treatment as the concurrency guards in race-conditions.test.ts:
// exercise the real failure mode against the real engine.
//
// Every order here goes into throwaway cafés built and destroyed by the
// fixture — never Brewora, never a real café. Deleting the café cascades to
// its orders and to its counter row. Needs SUPABASE_SERVICE_ROLE_KEY locally
// to build the fixture; skips (not fails) without it, same convention as the
// other integration suites.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) throw new Error('NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY not set (need .env.local)')

const hasAdmin = Boolean(URL && KEY && SERVICE_KEY)

type Cafe = { userId: string; cafeId: string; client: SupabaseClient; itemId: string }

describe.skipIf(!hasAdmin)('order numbering — atomic per-café daily counter (live, migration 0203)', () => {
  let admin: SupabaseClient
  let a: Cafe
  let b: Cafe

  // Same shape as the two-tenant fixture: a real owner, a real membership row
  // (staff_place_order authorizes off cafe_members, not cafes.owner_id) and
  // one menu item to order. A brand-new café has no counter row and no orders,
  // so its numbering starts from a known, clean state.
  async function makeCafe(label: string): Promise<Cafe> {
    const email = `test-${label}-${Date.now()}@khaopiyo-test.invalid`
    const password = crypto.randomUUID()
    const { data: userRes, error: userErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (userErr || !userRes.user) throw new Error(`fixture: could not create ${label} user — ${userErr?.message}`)

    const { data: cafe, error: cafeErr } = await admin
      .from('cafes')
      .insert({ owner_id: userRes.user.id, slug: `test-${label}-${Date.now()}`, name: `Numbering test ${label}` })
      .select('id').single()
    if (cafeErr || !cafe) throw new Error(`fixture: could not create ${label} café — ${cafeErr?.message}`)

    const { error: memberErr } = await admin
      .from('cafe_members')
      .insert({ cafe_id: cafe.id, user_id: userRes.user.id, role: 'owner' })
    if (memberErr) throw new Error(`fixture: could not add ${label} owner membership — ${memberErr.message}`)

    const { data: item, error: itemErr } = await admin
      .from('menu_items').insert({ cafe_id: cafe.id, name: 'Numbering Item', price: 100, available: true }).select('id').single()
    if (itemErr || !item) throw new Error(`fixture: could not create ${label} menu item — ${itemErr?.message}`)

    const client = createClient(URL!, KEY!, { auth: { persistSession: false } })
    const { error: signInErr } = await client.auth.signInWithPassword({ email, password })
    if (signInErr) throw new Error(`fixture: ${label} sign-in failed — ${signInErr.message}`)

    return { userId: userRes.user.id, cafeId: cafe.id as string, client, itemId: item.id as string }
  }

  // Places one POS order as the café's own owner. Every test below cares
  // about the number on the ticket, not the bill, so that is what comes back.
  async function placeOrder(c: Cafe) {
    const { data, error } = await c.client.rpc('staff_place_order', {
      p_cafe_id: c.cafeId,
      p_items: [{ item_id: c.itemId, qty: 1 }],
      p_order_type: 'takeaway',
    })
    if (error || !data) throw new Error(`could not place order — ${error?.message}`)
    const row = data as { order_id: string; short_code: string }
    return { orderId: row.order_id, number: Number(row.short_code) }
  }

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE_KEY!, { auth: { persistSession: false } })
    a = await makeCafe('num-a')
    b = await makeCafe('num-b')
  }, 60000)

  afterAll(async () => {
    // cafes -> orders and order_number_counters both cascade on delete, so
    // this leaves nothing behind in either table.
    for (const c of [a, b]) {
      if (c?.cafeId) await admin.from('cafes').delete().eq('id', c.cafeId)
      if (c?.userId) await admin.auth.admin.deleteUser(c.userId)
    }
  })

  // The live #3 case: 11:41 #3 cancelled, 11:46 #3 issued again to a
  // different table. Cancelling used to remove the order from count(*), which
  // handed its number straight to the next customer.
  it('never reissues the number of a cancelled order', { timeout: 30000 }, async () => {
    const first = await placeOrder(a)

    // Exactly what staff do — cancel_order (0017) as the café's own member,
    // the RPC behind both the Kitchen board and the Live Tables drawer. Not a
    // raw status write: a plain PATCH to 'cancelled' trips the audit_logs
    // insert policy, so it is not the path a real cancellation takes.
    const { error: cancelErr } = await a.client.rpc('cancel_order', {
      p_order_id: first.orderId,
      p_reason: 'vitest: numbering regression check',
    })
    expect(cancelErr, 'fixture: owner could not cancel their own order').toBeFalsy()

    const second = await placeOrder(a)
    expect(second.number, 'a cancelled order handed its bill number to the next order').not.toBe(first.number)
    expect(second.number).toBeGreaterThan(first.number)

    // The cancelled order keeps the number it was printed with — it is not
    // renumbered or blanked, it simply retires that number for the day.
    const { data: cancelled } = await admin.from('orders').select('short_code, status').eq('id', first.orderId).single()
    expect(cancelled?.status).toBe('cancelled')
    expect(Number(cancelled?.short_code)).toBe(first.number)
  })

  it('issues strictly increasing numbers across a café business day', { timeout: 30000 }, async () => {
    const numbers: number[] = []
    for (let i = 0; i < 3; i++) numbers.push((await placeOrder(a)).number)
    for (let i = 1; i < numbers.length; i++) {
      expect(numbers[i], 'order numbers must only ever go forward').toBeGreaterThan(numbers[i - 1])
    }

    // The invariant that actually matters at the till, checked against every
    // order this café has: no two of them share a bill number.
    const { data: all } = await admin.from('orders').select('short_code').eq('cafe_id', a.cafeId)
    const codes = (all ?? []).map((o) => o.short_code as string)
    expect(codes.length).toBeGreaterThanOrEqual(numbers.length)
    expect(new Set(codes).size, 'two orders in one café were given the same bill number').toBe(codes.length)
  })

  // The live #4 case: two completed, paid orders sharing a number, no
  // cancellation involved. count(*)+1 took no lock, so both reads saw the
  // same total. Promise.all fires them genuinely concurrently, the same way
  // race-conditions.test.ts proves the loyalty and coupon locks.
  it('gives two orders placed in the same instant two different numbers', { timeout: 30000 }, async () => {
    const [x, y] = await Promise.all([placeOrder(a), placeOrder(a)])
    expect(x.number, 'two concurrent orders were issued the same bill number').not.toBe(y.number)
  })

  it('keeps a separate sequence per café — one café never advances another\'s counter', { timeout: 30000 }, async () => {
    const beforeA = await placeOrder(a)

    const firstB = await placeOrder(b)
    expect(firstB.number, 'a second café\'s first order of the day must start its own sequence at 1').toBe(1)

    const afterA = await placeOrder(a)
    expect(afterA.number, 'café B\'s order advanced café A\'s counter').toBe(beforeA.number + 1)

    const { data: counters } = await admin
      .from('order_number_counters').select('cafe_id').in('cafe_id', [a.cafeId, b.cafeId])
    expect((counters ?? []).length, 'each café must hold its own counter row for the day').toBe(2)
  })

  // The seeding branch. When 0203 was applied mid-service the live cafés
  // already had orders on printed tickets and no counter row yet — if the
  // counter had started at 1 it would have reprinted the morning's numbers,
  // which is the very bug it was written to end.
  it('seeds from the day\'s high-water mark instead of reissuing a number today\'s orders already carry', { timeout: 30000 }, async () => {
    const before = await placeOrder(a)

    // Reproduce that exact state: real orders for today, no counter row.
    const { error: delErr } = await admin.from('order_number_counters').delete().eq('cafe_id', a.cafeId)
    expect(delErr, 'fixture: could not clear the counter row').toBeFalsy()

    const next = await placeOrder(a)
    expect(next.number, 'a re-seeded counter reissued a number already printed today').toBe(before.number + 1)

    const { data: all } = await admin.from('orders').select('short_code').eq('cafe_id', a.cafeId)
    const codes = (all ?? []).map((o) => o.short_code as string)
    expect(new Set(codes).size, 're-seeding produced a duplicate bill number').toBe(codes.length)
  })
})
