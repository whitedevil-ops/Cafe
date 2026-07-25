import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Daily cron (vercel.json) — the backstop the audit flagged as missing:
// subscription_ends_at was a pure display field nothing ever enforced. Any
// café whose subscription has actually lapsed (past-due with no further
// webhook, or simply never renewed) gets suspended here; a real webhook
// event reactivates it immediately (see .../webhook/route.ts) the moment
// billing resumes. Cafés with no subscription at all (billing_status='none',
// e.g. manually managed by a platform admin) are never touched.
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !url) return NextResponse.json({ error: 'not configured' }, { status: 503 })

  const admin = createServiceClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: expired, error } = await admin
    .from('cafes')
    .select('id')
    .eq('status', 'active')
    .in('billing_status', ['past_due', 'cancelled'])
    .lt('subscription_ends_at', new Date().toISOString())
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const ids = (expired ?? []).map((c) => c.id as string)
  if (ids.length > 0) {
    await admin
      .from('cafes')
      .update({ status: 'suspended', status_reason: 'Subscription expired', status_changed_at: new Date().toISOString() })
      .in('id', ids)
  }

  return NextResponse.json({ ok: true, suspended: ids.length })
}
