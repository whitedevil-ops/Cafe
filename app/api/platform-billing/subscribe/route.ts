import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { getCurrentCafe } from '@/lib/cafe'
import { razorpayConfigured, createRazorpaySubscription, RAZORPAY_KEY_ID } from '@/lib/razorpay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Starts a platform subscription for the CALLER's own café (KhaoPiyo billing
// the café, on KhaoPiyo's own Razorpay account — RAZORPAY_KEY_ID/SECRET, not
// a per-café connected account). Only creates the subscription and returns
// the checkout handle; the café's plan/billing_status only change once the
// verified webhook confirms activation — never from this response.
export async function POST(req: Request) {
  if (!razorpayConfigured()) {
    return NextResponse.json({ error: 'Billing is not available right now.' }, { status: 503 })
  }

  const cafe = await getCurrentCafe()
  if (!cafe) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (cafe.role !== 'owner') {
    return NextResponse.json({ error: 'Only the café owner can change the billing plan.' }, { status: 403 })
  }

  let planKey = ''
  try {
    const b = (await req.json()) as { plan_key?: string }
    planKey = String(b.plan_key ?? '')
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (!planKey) return NextResponse.json({ error: 'Choose a plan.' }, { status: 400 })

  const supabase = await createClient()
  const { data: plan } = await supabase
    .from('platform_plans')
    .select('key, name, razorpay_plan_id')
    .eq('key', planKey)
    .maybeSingle()
  if (!plan?.razorpay_plan_id) {
    return NextResponse.json({ error: 'This plan is not yet available for online billing.' }, { status: 400 })
  }

  const sub = await createRazorpaySubscription({
    planId: plan.razorpay_plan_id,
    notes: { cafe_id: cafe.cafeId, plan_key: plan.key },
  })
  if ('error' in sub) {
    return NextResponse.json({ error: 'Could not start the subscription. Please try again.' }, { status: 502 })
  }

  const { error: updateErr } = await supabase
    .from('cafes')
    .update({ razorpay_subscription_id: sub.id, billing_status: 'created' })
    .eq('id', cafe.cafeId)
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  return NextResponse.json({ subscription_id: sub.id, key_id: RAZORPAY_KEY_ID, plan_name: plan.name })
}
