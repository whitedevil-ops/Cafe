// Regression tests for wallet_confirm_topup (migrations 0091/0093/0139/0148).
//
// This RPC had NO live test coverage at all before this file, which is
// exactly how a genuine bug survived undetected in it since 0091: its final
// UPDATE wrote to payment_attempts.provider_payment_id, a column that has
// never existed on that table (the real provider_payment_id columns live on
// `payments` and `wallet_transactions`). Because the error only surfaces at
// RUNTIME (Postgres doesn't validate a plpgsql function's embedded SQL
// against the schema at CREATE time), and nothing ever called this function
// in a test, it went unnoticed through 0093's rewrite and 0139's own
// race-condition fix — every real Razorpay-triggered wallet top-up
// confirmation was failing outright the whole time. 0148 fixes the column
// reference; these tests both prove that fix and guard the race-condition
// fix from 0139 (re-checking status after the advisory lock, and the
// wallet_transactions_topup_payment_uq backstop) against regressing.
//
// Needs SUPABASE_SERVICE_ROLE_KEY locally — wallet_confirm_topup is granted
// to service_role only (0119), matching exactly how the real Razorpay
// webhook route invokes it. Skips (not fails) without it, same convention as
// every other file in this directory.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) throw new Error('NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY not set (need .env.local)')

const hasAdmin = Boolean(URL && KEY && SERVICE_KEY)

describe.skipIf(!hasAdmin)('wallet_confirm_topup regression guard (live)', () => {
  let admin: SupabaseClient
  let cafeId: string
  let ownerUserId: string
  let tierId: string
  const PAY_AMOUNT = 100
  const CREDIT_AMOUNT = 120

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE_KEY!, { auth: { persistSession: false } })
    const email = `test-wallet-owner-${Date.now()}@khaopiyo-test.invalid`
    const { data: userRes, error: userErr } = await admin.auth.admin.createUser({
      email, password: crypto.randomUUID(), email_confirm: true,
    })
    if (userErr || !userRes.user) throw new Error(`fixture: could not create test user — ${userErr?.message}`)
    ownerUserId = userRes.user.id

    const { data: cafe, error: cafeErr } = await admin
      .from('cafes')
      .insert({ owner_id: ownerUserId, slug: `test-wallet-${Date.now()}`, name: 'Wallet top-up test café' })
      .select('id').single()
    if (cafeErr || !cafe) throw new Error(`fixture: could not create test café — ${cafeErr?.message}`)
    cafeId = cafe.id

    const { data: tier, error: tierErr } = await admin
      .from('wallet_topup_tiers')
      .insert({ cafe_id: cafeId, pay_amount: PAY_AMOUNT, credit_amount: CREDIT_AMOUNT })
      .select('id').single()
    if (tierErr || !tier) throw new Error(`fixture: could not create top-up tier — ${tierErr?.message}`)
    tierId = tier.id
  })

  afterAll(async () => {
    if (cafeId) await admin.from('cafes').delete().eq('id', cafeId)
    if (ownerUserId) await admin.auth.admin.deleteUser(ownerUserId)
  })

  async function makeCustomer(tag: string) {
    const { data, error } = await admin
      .from('customers')
      .insert({ cafe_id: cafeId, phone: `9${String(Date.now()).slice(-9)}`, name: `Wallet Test ${tag}` })
      .select('id').single()
    if (error || !data) throw new Error(`fixture: could not create customer — ${error?.message}`)
    return data.id as string
  }

  async function startAttempt(customerId: string) {
    const { data, error } = await admin
      .from('payment_attempts')
      .insert({ cafe_id: cafeId, customer_id: customerId, wallet_tier_id: tierId, amount: PAY_AMOUNT, purpose: 'wallet_topup' })
      .select('id, status').single()
    if (error || !data) throw new Error(`fixture: could not create payment attempt — ${error?.message}`)
    return data
  }

  it('confirms a top-up, marks the attempt confirmed, and credits the wallet exactly once', async () => {
    const customerId = await makeCustomer('confirm')
    const attempt = await startAttempt(customerId)
    expect(attempt.status, 'a fresh attempt must not already be confirmed').not.toBe('confirmed')

    const { error } = await admin.rpc('wallet_confirm_topup', {
      p_attempt_id: attempt.id,
      p_provider_payment_id: 'test_pay_confirm_1',
    })
    // This is the core regression check: before 0148, this call fails with
    // "column provider_payment_id of relation payment_attempts does not
    // exist" every single time.
    expect(error, 'wallet_confirm_topup must not error on a normal confirmation').toBeNull()

    const { data: attemptAfter } = await admin
      .from('payment_attempts').select('status, confirmed_at').eq('id', attempt.id).single()
    expect(attemptAfter?.status, 'the attempt must be marked confirmed').toBe('confirmed')
    expect(attemptAfter?.confirmed_at, 'confirmed_at must be stamped').not.toBeNull()

    const { data: txns } = await admin
      .from('wallet_transactions')
      .select('kind, amount, topup_tier_id, provider_payment_id')
      .eq('customer_id', customerId)
    expect((txns ?? []).length, 'exactly one wallet_transactions row for this top-up').toBe(1)
    expect(txns![0].kind).toBe('topup')
    expect(txns![0].amount, 'the wallet must be credited the tier\'s credit_amount, not the pay_amount').toBe(CREDIT_AMOUNT)
    expect(txns![0].topup_tier_id).toBe(tierId)
    expect(txns![0].provider_payment_id).toBe('test_pay_confirm_1')
  })

  it('a duplicate webhook delivery for the same attempt is a safe no-op, not a double credit', async () => {
    const customerId = await makeCustomer('duplicate')
    const attempt = await startAttempt(customerId)

    const first = await admin.rpc('wallet_confirm_topup', {
      p_attempt_id: attempt.id, p_provider_payment_id: 'test_pay_dup_1',
    })
    expect(first.error).toBeNull()

    // Razorpay redelivers the same event on timeout/retry — this is the
    // exact shape 0139 was written to make safe.
    const second = await admin.rpc('wallet_confirm_topup', {
      p_attempt_id: attempt.id, p_provider_payment_id: 'test_pay_dup_1',
    })
    expect(second.error, 'a duplicate delivery for an already-confirmed attempt must not error').toBeNull()

    const { data: txns } = await admin
      .from('wallet_transactions').select('id').eq('customer_id', customerId)
    expect((txns ?? []).length, 'a duplicate delivery must never credit the wallet twice').toBe(1)
  })

  it('two concurrent confirmations for the same fresh attempt still credit only once', { timeout: 30000 }, async () => {
    const customerId = await makeCustomer('race')
    const attempt = await startAttempt(customerId)

    const confirm = () => admin.rpc('wallet_confirm_topup', {
      p_attempt_id: attempt.id, p_provider_payment_id: 'test_pay_race_1',
    })
    const [a, b] = await Promise.all([confirm(), confirm()])

    const bothErrored = a.error && b.error
    expect(bothErrored, 'at least one of the two concurrent confirmations should succeed').toBeFalsy()

    const { data: txns } = await admin
      .from('wallet_transactions').select('id').eq('customer_id', customerId)
    expect((txns ?? []).length, 'a concurrent double-confirmation must credit the wallet exactly once').toBe(1)

    const { data: attemptAfter } = await admin
      .from('payment_attempts').select('status').eq('id', attempt.id).single()
    expect(attemptAfter?.status).toBe('confirmed')
  })
})
