import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { sendWhatsAppBill, sendWhatsAppOrderPlaced } from '@/lib/whatsapp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Fired immediately (fire-and-forget) right after an order's payment is
// recorded — from the staff dashboard (POS, Live Tables) and, once the QR
// flow's own payment paths complete, the customer side too. Auth is the
// order's own receipt_token, an unguessable uuid — the same trust boundary
// the public /r/[token] bill page and the Razorpay webhook route already
// use, since there's no user session to check on the QR side.
//
// Sends whatever whatsapp_logs rows are 'pending' for this order — as of
// 0215, that is at most ONE: the "bill" message, queued only once
// payment_status actually transitions to 'paid'. There used to also be an
// "order placed" message queued the instant an order was created; it's
// gone, on purpose — see 0215's header. It baked the order's total into
// fixed template text at creation time, which had no way to stay correct
// once "add items to an existing bill" was ever built, and it was a second
// paid WhatsApp Cloud API template send per order for a confirmation most
// cafés only wanted once, at the moment that matters to the customer: when
// they've actually paid.
//
// The staff Retry button (app/api/whatsapp/retry) stays as the manual
// fallback for whatever this misses (closed tab, network drop, feature
// added after the trigger already fired).
export async function POST(req: NextRequest) {
  const { receipt_token } = (await req.json().catch(() => ({}))) as { receipt_token?: string }
  if (!receipt_token) return NextResponse.json({ error: 'receipt_token required' }, { status: 400 })

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !url) return NextResponse.json({ ok: true, sent: [] })
  const admin = createServiceClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: order } = await admin
    .from('orders')
    .select('id, cafe_id, short_code, total, phone, receipt_token, cafes(name)')
    .eq('receipt_token', receipt_token)
    .maybeSingle()
  if (!order?.phone) return NextResponse.json({ ok: true, sent: [] })

  // Same override-then-plan-default precedence as cafe_has_feature (0019),
  // read directly rather than via that RPC — it keys off auth.uid() for the
  // is_cafe_member() check, which is null under a service-role call with no
  // signed-in user, so it would always return false here regardless of the
  // café's real entitlement.
  const { data: override } = await admin
    .from('cafe_feature_overrides')
    .select('enabled')
    .eq('cafe_id', order.cafe_id)
    .eq('feature_key', 'whatsapp_bills')
    .maybeSingle()
  let enabled = override?.enabled ?? null
  if (enabled === null) {
    const { data: cafeRow } = await admin.from('cafes').select('plan').eq('id', order.cafe_id).maybeSingle()
    const { data: plan } = await admin.from('platform_plans').select('features').eq('key', cafeRow?.plan ?? '').maybeSingle()
    enabled = Boolean((plan?.features as Record<string, boolean> | null)?.whatsapp_bills)
  }
  if (!enabled) return NextResponse.json({ ok: true, sent: [] })

  const { data: logs } = await admin
    .from('whatsapp_logs')
    .select('id, type')
    .eq('order_id', order.id)
    .eq('status', 'pending')
  if (!logs?.length) return NextResponse.json({ ok: true, sent: [] })

  const cafe = Array.isArray(order.cafes) ? order.cafes[0] : order.cafes
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://khaopiyo.ventron.in'
  const billUrl = `${base}/r/${order.receipt_token}`

  const sent = []
  for (const log of logs) {
    const sendFn = log.type === 'order_placed' ? sendWhatsAppOrderPlaced : sendWhatsAppBill
    const result = await sendFn(order.phone, cafe?.name ?? 'Your café', order.short_code, order.total, billUrl)
    await admin
      .from('whatsapp_logs')
      .update(
        result.ok
          ? { status: 'sent', sent_at: new Date().toISOString(), error: null }
          : { status: 'failed', failed_at: new Date().toISOString(), error: result.error },
      )
      .eq('id', log.id)
    sent.push({ type: log.type, ok: result.ok })
  }

  return NextResponse.json({ ok: true, sent })
}
