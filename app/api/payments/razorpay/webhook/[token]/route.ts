import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { verifyWebhookSignature } from '@/lib/razorpay'
import { encryptionConfigured, decryptSecret } from '@/lib/crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Per-café webhook. The URL carries an opaque token that identifies which
// café this delivery is for, so we can verify the signature with THAT café's
// own webhook secret. This is the only authoritative path to PAID.
//
// IDEMPOTENT via the unique (provider, provider_payment_id) index — a
// duplicate delivery conflicts on insert and is treated as already-processed.
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const raw = await req.text() // RAW body — signature is over the exact bytes
  const signature = req.headers.get('x-razorpay-signature')

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !url || !encryptionConfigured()) {
    return NextResponse.json({ error: 'not configured' }, { status: 503 })
  }

  const admin = createServiceClient(url, serviceKey, { auth: { persistSession: false } })

  // Resolve which café this webhook belongs to, and its secret.
  const { data: cafe } = await admin
    .from('cafes')
    .select('id')
    .eq('razorpay_webhook_token', token)
    .maybeSingle()
  if (!cafe) return NextResponse.json({ error: 'unknown endpoint' }, { status: 404 })

  const { data: secrets } = await admin
    .from('cafe_payment_secrets')
    .select('webhook_secret_enc')
    .eq('cafe_id', cafe.id)
    .maybeSingle()
  if (!secrets?.webhook_secret_enc) return NextResponse.json({ error: 'no webhook secret' }, { status: 400 })

  let webhookSecret: string
  try {
    webhookSecret = decryptSecret(secrets.webhook_secret_enc as string)
  } catch {
    return NextResponse.json({ error: 'config error' }, { status: 500 })
  }

  if (!verifyWebhookSignature(raw, signature, webhookSecret)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  let event: {
    event?: string
    payload?: { payment?: { entity?: { id?: string; order_id?: string; amount?: number } } }
  }
  try {
    event = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'bad payload' }, { status: 400 })
  }
  if (event.event !== 'payment.captured') {
    return NextResponse.json({ ok: true, ignored: event.event })
  }

  const p = event.payload?.payment?.entity
  if (!p?.id || !p.order_id || typeof p.amount !== 'number') {
    return NextResponse.json({ error: 'incomplete payment' }, { status: 400 })
  }

  // Match the attempt within THIS café only — a webhook for one café can never
  // touch another café's orders.
  const { data: attempt } = await admin
    .from('payment_attempts')
    .select('id, order_id, amount')
    .eq('provider_order_id', p.order_id)
    .eq('cafe_id', cafe.id)
    .maybeSingle()
  if (!attempt) return NextResponse.json({ ok: true, unmatched: p.order_id })

  const { error: insErr } = await admin.from('payments').insert({
    cafe_id: cafe.id,
    order_id: attempt.order_id,
    method: 'upi',
    amount: Math.round(p.amount / 100),
    source: 'gateway',
    provider: 'razorpay',
    provider_order_id: p.order_id,
    provider_payment_id: p.id,
    status: 'captured',
    verified_at: new Date().toISOString(),
    attempt_id: attempt.id,
  })
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
