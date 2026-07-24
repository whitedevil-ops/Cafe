import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { razorpayConfigured, createRazorpayOrder, RAZORPAY_KEY_ID } from '@/lib/razorpay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Starts an online payment for a QR order. The amount is computed on the
// SERVER from the order's outstanding — the customer's browser only supplies
// the receipt token. Nothing here marks the order paid; that happens only via
// the verified webhook.
//
// Requires BOTH the platform's Razorpay credentials and a Supabase
// service-role key (the customer is anonymous and cannot write payment_
// attempts under RLS). Absent either, online payments are not operational and
// this returns 503 — the customer falls back to pay-at-counter.
export async function POST(req: Request) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!razorpayConfigured() || !serviceKey || !url) {
    return NextResponse.json(
      { error: 'Online payments are not available for this café right now. Please pay at the counter.' },
      { status: 503 },
    )
  }

  let receiptToken: string
  try {
    const body = (await req.json()) as { receipt_token?: string }
    receiptToken = String(body.receipt_token ?? '')
    if (!receiptToken) throw new Error('missing token')
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  // Service-role client bypasses RLS deliberately — this is a trusted server
  // context. It reads exactly one order by its opaque receipt token.
  const admin = createServiceClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: order } = await admin
    .from('orders')
    .select('id, cafe_id, total')
    .eq('receipt_token', receiptToken)
    .maybeSingle()
  if (!order) return NextResponse.json({ error: 'Order not found.' }, { status: 404 })

  const { data: cafe } = await admin
    .from('cafes')
    .select('name, online_payments_enabled, razorpay_status, razorpay_account_id')
    .eq('id', order.cafe_id)
    .maybeSingle()
  if (!cafe?.online_payments_enabled || cafe.razorpay_status !== 'connected') {
    return NextResponse.json({ error: 'This café does not accept online payments.' }, { status: 400 })
  }

  // Server-authoritative outstanding.
  const { data: paidRows } = await admin.from('payments').select('amount').eq('order_id', order.id)
  const paid = (paidRows ?? []).reduce((s, p) => s + (p.amount as number), 0)
  const due = Math.max(0, (order.total as number) - paid)
  if (due <= 0) return NextResponse.json({ error: 'This order is already paid.' }, { status: 400 })

  const rzp = await createRazorpayOrder({
    amountPaise: due * 100,
    receipt: `order_${order.id}`,
    notes: { cafe_id: order.cafe_id as string, order_id: order.id as string },
    linkedAccountId: cafe.razorpay_account_id ?? undefined,
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
    key_id: RAZORPAY_KEY_ID,
    order_id: rzp.id,
    amount: due,
    currency: 'INR',
    name: cafe.name,
  })
}
