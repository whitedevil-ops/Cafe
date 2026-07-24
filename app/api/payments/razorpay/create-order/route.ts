import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createRazorpayOrder } from '@/lib/razorpay'
import { encryptionConfigured, decryptSecret } from '@/lib/crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Starts an online payment for a QR order on the CAFÉ's own Razorpay account.
// The amount is computed on the SERVER from the order's outstanding; the
// customer's browser only supplies the receipt token. Nothing here marks the
// order paid — that happens only via the verified webhook.
export async function POST(req: Request) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !url || !encryptionConfigured()) {
    return NextResponse.json(
      { error: 'Online payments are not available right now. Please pay at the counter.' },
      { status: 503 },
    )
  }

  let receiptToken = ''
  try {
    const b = (await req.json()) as { receipt_token?: string }
    receiptToken = String(b.receipt_token ?? '')
    if (!receiptToken) throw new Error('missing')
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const admin = createServiceClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: order } = await admin
    .from('orders')
    .select('id, cafe_id, total, short_code')
    .eq('receipt_token', receiptToken)
    .maybeSingle()
  if (!order) return NextResponse.json({ error: 'Order not found.' }, { status: 404 })

  const { data: cafe } = await admin
    .from('cafes')
    .select('name, online_payments_enabled, razorpay_status, razorpay_key_id')
    .eq('id', order.cafe_id)
    .maybeSingle()
  if (!cafe?.online_payments_enabled || cafe.razorpay_status !== 'connected' || !cafe.razorpay_key_id) {
    return NextResponse.json({ error: 'This café does not accept online payments.' }, { status: 400 })
  }

  const { data: secrets } = await admin
    .from('cafe_payment_secrets')
    .select('key_secret_enc')
    .eq('cafe_id', order.cafe_id)
    .maybeSingle()
  if (!secrets?.key_secret_enc) {
    return NextResponse.json({ error: 'This café is not fully configured for online payments.' }, { status: 400 })
  }

  // Server-authoritative outstanding.
  const { data: paidRows } = await admin.from('payments').select('amount').eq('order_id', order.id)
  const paid = (paidRows ?? []).reduce((s, p) => s + (p.amount as number), 0)
  const due = Math.max(0, (order.total as number) - paid)
  if (due <= 0) return NextResponse.json({ error: 'This order is already paid.' }, { status: 400 })

  let keySecret: string
  try {
    keySecret = decryptSecret(secrets.key_secret_enc as string)
  } catch {
    return NextResponse.json({ error: 'Payment configuration error.' }, { status: 500 })
  }

  const rzp = await createRazorpayOrder({
    keyId: cafe.razorpay_key_id as string,
    keySecret,
    amountPaise: due * 100,
    receipt: `order_${order.short_code}`,
    notes: { cafe_id: order.cafe_id as string, order_id: order.id as string },
  })
  if ('error' in rzp) {
    return NextResponse.json({ error: 'Could not start the payment. Please pay at the counter.' }, { status: 502 })
  }

  await admin.from('payment_attempts').insert({
    cafe_id: order.cafe_id,
    order_id: order.id,
    amount: due,
    method: 'razorpay',
    status: 'initiated',
    provider: 'razorpay',
    provider_order_id: rzp.id,
  })

  return NextResponse.json({
    key_id: cafe.razorpay_key_id,
    order_id: rzp.id,
    amount: due,
    currency: 'INR',
    name: cafe.name,
  })
}
