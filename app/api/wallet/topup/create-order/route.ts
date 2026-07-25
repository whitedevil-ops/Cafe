import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createRazorpayOrder } from '@/lib/razorpay'
import { encryptionConfigured, decryptSecret } from '@/lib/crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Starts a wallet top-up payment on the CAFÉ's own Razorpay account. The
// pending payment_attempts row (created by wallet_start_topup, which already
// validated the tier + café entitlement) is the only source of truth for the
// amount — nothing here is client-supplied. Nothing here credits the
// wallet — that happens only via the verified webhook (wallet_confirm_topup).
export async function POST(req: Request) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !url || !encryptionConfigured()) {
    return NextResponse.json({ error: 'Wallet top-ups are not available right now.' }, { status: 503 })
  }

  let attemptId = ''
  try {
    const b = (await req.json()) as { attempt_id?: string }
    attemptId = String(b.attempt_id ?? '')
    if (!attemptId) throw new Error('missing')
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const admin = createServiceClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: attempt } = await admin
    .from('payment_attempts')
    .select('id, cafe_id, customer_id, amount, status, purpose')
    .eq('id', attemptId)
    .eq('purpose', 'wallet_topup')
    .maybeSingle()
  if (!attempt) return NextResponse.json({ error: 'Top-up request not found.' }, { status: 404 })
  if (attempt.status !== 'initiated') {
    return NextResponse.json({ error: 'This top-up has already been started.' }, { status: 400 })
  }

  const { data: cafe } = await admin
    .from('cafes')
    .select('name, online_payments_enabled, razorpay_status, razorpay_key_id')
    .eq('id', attempt.cafe_id)
    .maybeSingle()
  if (!cafe?.online_payments_enabled || cafe.razorpay_status !== 'connected' || !cafe.razorpay_key_id) {
    return NextResponse.json({ error: 'This café does not accept online payments.' }, { status: 400 })
  }

  const { data: secrets } = await admin
    .from('cafe_payment_secrets')
    .select('key_secret_enc')
    .eq('cafe_id', attempt.cafe_id)
    .maybeSingle()
  if (!secrets?.key_secret_enc) {
    return NextResponse.json({ error: 'This café is not fully configured for online payments.' }, { status: 400 })
  }

  let keySecret: string
  try {
    keySecret = decryptSecret(secrets.key_secret_enc as string)
  } catch {
    return NextResponse.json({ error: 'Payment configuration error.' }, { status: 500 })
  }

  const rzp = await createRazorpayOrder({
    keyId: cafe.razorpay_key_id as string,
    keySecret,
    amountPaise: (attempt.amount as number) * 100,
    receipt: `wallet_${attempt.id.slice(0, 8)}`,
    notes: { cafe_id: attempt.cafe_id as string, customer_id: attempt.customer_id as string, purpose: 'wallet_topup' },
  })
  if ('error' in rzp) {
    return NextResponse.json({ error: 'Could not start the top-up. Please try again.' }, { status: 502 })
  }

  await admin.from('payment_attempts').update({ provider: 'razorpay', provider_order_id: rzp.id }).eq('id', attempt.id)

  return NextResponse.json({
    key_id: cafe.razorpay_key_id,
    order_id: rzp.id,
    amount: attempt.amount,
    currency: 'INR',
    name: cafe.name,
  })
}
