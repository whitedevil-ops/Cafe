import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { sendWhatsAppBill, sendWhatsAppOrderPlaced } from '@/lib/whatsapp'
import { hasFeature } from '@/lib/entitlements'

// Staff-triggered (re)send of a bill WhatsApp message — mirrors
// app/api/sms/retry/route.ts exactly, second channel, same trust boundary.
// Auth + tenant scoping come from the caller's session: RLS only returns
// whatsapp_logs/orders for cafés they belong to. The full phone number never
// leaves the server.
export async function POST(req: NextRequest) {
  const { log_id } = (await req.json().catch(() => ({}))) as { log_id?: string }
  if (!log_id) return NextResponse.json({ error: 'log_id required' }, { status: 400 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: log } = await supabase
    .from('whatsapp_logs')
    .select('id, order_id, cafe_id, status, type')
    .eq('id', log_id)
    .maybeSingle()
  if (!log) return NextResponse.json({ error: 'not found' }, { status: 404 })

  if (!(await hasFeature(log.cafe_id, 'whatsapp_bills'))) {
    return NextResponse.json({ error: "WhatsApp bill receipts aren't on your plan." }, { status: 403 })
  }

  const { data: order } = await supabase
    .from('orders')
    .select('short_code, total, phone, receipt_token, cafes(name)')
    .eq('id', log.order_id)
    .maybeSingle()
  if (!order?.phone) return NextResponse.json({ error: 'order has no phone number' }, { status: 400 })

  const cafe = Array.isArray(order.cafes) ? order.cafes[0] : order.cafes
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://khaopiyo.ventron.in'
  const sendFn = log.type === 'order_placed' ? sendWhatsAppOrderPlaced : sendWhatsAppBill
  const result = await sendFn(
    order.phone,
    cafe?.name ?? 'Your café',
    order.short_code,
    order.total,
    `${base}/r/${order.receipt_token}`,
  )

  await supabase
    .from('whatsapp_logs')
    .update(
      result.ok
        ? { status: 'sent', sent_at: new Date().toISOString(), error: null }
        : { status: 'failed', failed_at: new Date().toISOString(), error: result.error },
    )
    .eq('id', log.id)

  return NextResponse.json({ ok: result.ok, error: result.error ?? null })
}
