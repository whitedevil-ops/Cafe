import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { verifyWebhookSignature, RAZORPAY_WEBHOOK_SECRET } from '@/lib/razorpay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Platform billing webhook — KhaoPiyo's own Razorpay account notifying us
// that a CAFÉ's subscription changed state. Single endpoint (not per-café,
// unlike customer payments) because this is entirely on the platform's own
// Razorpay account; the subscription id in the payload tells us which café.
//
// This is the ONLY path that ever flips billing_status/plan/subscription_ends_at
// — never a client callback. A daily cron (app/api/platform-billing/check-expiry)
// is the backstop for cafés whose subscription lapses with no further webhook.
type RazorpayEvent = {
  event?: string
  payload?: {
    subscription?: {
      entity?: {
        id?: string
        status?: string
        current_end?: number // unix seconds
        notes?: { cafe_id?: string; plan_key?: string }
      }
    }
  }
}

export async function POST(req: Request) {
  const raw = await req.text()
  const signature = req.headers.get('x-razorpay-signature')

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !url || !RAZORPAY_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'not configured' }, { status: 503 })
  }

  if (!verifyWebhookSignature(raw, signature, RAZORPAY_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  let event: RazorpayEvent
  try {
    event = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'bad payload' }, { status: 400 })
  }

  const sub = event.payload?.subscription?.entity
  const eventName = event.event ?? ''
  if (!sub?.id) return NextResponse.json({ ok: true, ignored: eventName })

  const admin = createServiceClient(url, serviceKey, { auth: { persistSession: false } })

  // Resolve the café by subscription id, not by the (spoofable) notes on the
  // payload — the id was recorded server-side in /api/platform-billing/subscribe.
  const { data: cafe } = await admin
    .from('cafes')
    .select('id, plan')
    .eq('razorpay_subscription_id', sub.id)
    .maybeSingle()
  if (!cafe) return NextResponse.json({ ok: true, unmatched: sub.id })

  await admin.from('platform_billing_events').insert({
    cafe_id: cafe.id,
    razorpay_subscription_id: sub.id,
    event_type: eventName,
    payload: event as unknown as Record<string, unknown>,
  })

  const currentEnd = sub.current_end ? new Date(sub.current_end * 1000).toISOString() : null
  const planKey = sub.notes?.plan_key

  switch (eventName) {
    case 'subscription.activated':
    case 'subscription.charged':
      await admin
        .from('cafes')
        .update({
          billing_status: 'active',
          status: 'active',
          subscription_ends_at: currentEnd,
          expiry_reminder_sent_at: null,
          ...(planKey ? { plan: planKey } : {}),
        })
        .eq('id', cafe.id)
      break
    case 'subscription.pending':
    case 'subscription.halted':
      // Razorpay is retrying a failed charge — grace period, not an
      // immediate suspension. The expiry cron is what eventually acts on this
      // once subscription_ends_at actually passes.
      await admin.from('cafes').update({ billing_status: 'past_due' }).eq('id', cafe.id)
      break
    case 'subscription.cancelled':
    case 'subscription.completed':
      await admin.from('cafes').update({ billing_status: 'cancelled' }).eq('id', cafe.id)
      break
    default:
      break
  }

  return NextResponse.json({ ok: true })
}
