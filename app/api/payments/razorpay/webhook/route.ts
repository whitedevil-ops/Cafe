import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { webhookConfigured, verifyWebhookSignature, RAZORPAY_WEBHOOK_SECRET } from '@/lib/razorpay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The ONLY authoritative way an online order becomes PAID. Razorpay POSTs
// here after a payment; we verify the signature, then record the payment.
// The frontend success callback is UX only and never touches payment state.
//
// IDEMPOTENT: the payments table has a unique index on
// (provider, provider_payment_id), so a duplicate webhook delivery cannot
// create a second payment row — the second insert conflicts and is ignored.
export async function POST(req: Request) {
  const raw = await req.text() // RAW body — signature is computed over the exact bytes
  const signature = req.headers.get('x-razorpay-signature')

  if (!webhookConfigured()) {
    return NextResponse.json({ error: 'not configured' }, { status: 503 })
  }
  if (!verifyWebhookSignature(raw, signature, RAZORPAY_WEBHOOK_SECRET)) {
    // A request whose signature does not verify is discarded, whatever it claims.
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !url) {
    // Signature was valid but we cannot process yet — 500 so Razorpay retries.
    return NextResponse.json({ error: 'processing unavailable' }, { status: 500 })
  }

  let event: {
    event?: string
    payload?: { payment?: { entity?: { id?: string; order_id?: string; amount?: number; method?: string } } }
  }
  try {
    event = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'bad payload' }, { status: 400 })
  }

  // Only a captured payment settles the bill. Other events are acknowledged.
  if (event.event !== 'payment.captured') {
    return NextResponse.json({ ok: true, ignored: event.event })
  }

  const p = event.payload?.payment?.entity
  if (!p?.id || !p.order_id || typeof p.amount !== 'number') {
    return NextResponse.json({ error: 'incomplete payment' }, { status: 400 })
  }

  const admin = createServiceClient(url, serviceKey, { auth: { persistSession: false } })

  // Map the provider order back to our order via the attempt we created.
  const { data: attempt } = await admin
    .from('payment_attempts')
    .select('id, cafe_id, order_id, amount')
    .eq('provider_order_id', p.order_id)
    .maybeSingle()
  if (!attempt) return NextResponse.json({ ok: true, unmatched: p.order_id })

  // Insert the immutable payment. The unique (provider, provider_payment_id)
  // index makes this a no-op on a duplicate delivery.
  const { error: insErr } = await admin.from('payments').insert({
    cafe_id: attempt.cafe_id,
    order_id: attempt.order_id,
    method: 'upi',
    amount: Math.round(p.amount / 100), // paise → rupees
    source: 'gateway',
    provider: 'razorpay',
    provider_order_id: p.order_id,
    provider_payment_id: p.id,
    status: 'captured',
    verified_at: new Date().toISOString(),
    attempt_id: attempt.id,
  })
  // 23505 = unique violation = already processed. That's success, not failure.
  if (insErr && insErr.code !== '23505') {
    return NextResponse.json({ error: 'insert failed' }, { status: 500 })
  }

  await admin
    .from('payment_attempts')
    .update({ status: 'confirmed', confirmed_at: new Date().toISOString(), provider_payment_id: p.id })
    .eq('id', attempt.id)
  await admin.rpc('recompute_order_payment_status', { p_order_id: attempt.order_id })

  return NextResponse.json({ ok: true })
}
