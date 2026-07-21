import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { sendSms, billSmsText } from '@/lib/sms'

// Staff-triggered (re)send of a bill SMS. Auth + tenant scoping come from the
// caller's session: RLS only returns sms_logs/orders for cafés they belong to.
// The full phone number never leaves the server.
export async function POST(req: NextRequest) {
  const { log_id } = (await req.json().catch(() => ({}))) as { log_id?: string }
  if (!log_id) return NextResponse.json({ error: 'log_id required' }, { status: 400 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: log } = await supabase
    .from('sms_logs')
    .select('id, order_id, cafe_id, status')
    .eq('id', log_id)
    .maybeSingle()
  if (!log) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const { data: order } = await supabase
    .from('orders')
    .select('short_code, total, phone, payment_method, receipt_token, cafes(name)')
    .eq('id', log.order_id)
    .maybeSingle()
  if (!order?.phone) return NextResponse.json({ error: 'order has no phone number' }, { status: 400 })

  const cafe = Array.isArray(order.cafes) ? order.cafes[0] : order.cafes
  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const text = billSmsText(
    cafe?.name ?? 'Your café',
    order.short_code,
    order.total,
    order.payment_method === 'card' ? 'Card' : 'Cash',
    `${base}/r/${order.receipt_token}`,
  )

  const result = await sendSms(order.phone, text)

  await supabase
    .from('sms_logs')
    .update(
      result.ok
        ? { status: 'sent', provider: result.provider, sent_at: new Date().toISOString(), error: null }
        : { status: 'failed', provider: result.provider, failed_at: new Date().toISOString(), error: result.error },
    )
    .eq('id', log.id)

  return NextResponse.json({ ok: result.ok, error: result.error ?? null })
}
