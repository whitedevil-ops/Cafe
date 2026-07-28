import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { sendEmail, emailConfigured, planExpiryReminderEmail } from '@/lib/email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Daily cron (vercel.json) — the backstop the audit flagged as missing:
// subscription_ends_at was a pure display field nothing ever enforced. Any
// café whose subscription has actually lapsed (past-due with no further
// webhook, or simply never renewed) gets suspended here; a real webhook
// event reactivates it immediately (see .../webhook/route.ts) the moment
// billing resumes.
//
// billing_status='none' (manually managed by a platform admin, no real
// Razorpay subscription behind it — true for every café today) IS included
// here: found live that setting subscription_ends_at via
// op_extend_subscription silently did nothing once the date passed,
// because this query only ever matched 'past_due'/'cancelled'. For a
// billing_status='none' café, subscription_ends_at is the ONLY expiry
// signal there is — an operator setting it is a real, intended enforcement
// date, not a display field. 'active' cafés (a genuine live Razorpay
// subscription) are deliberately NOT included: Razorpay's own webhook is
// the trusted signal there, so a merely-stale subscription_ends_at from a
// missed webhook doesn't suspend a paying customer on its own.
//
// Also emails the café owner once per expiry cycle when subscription_ends_at
// is within 7 days — expiry_reminder_sent_at (0114) is the dedupe guard,
// reset to null whenever the date actually changes (op_extend_subscription,
// or a renewal webhook) so a renewed café gets a fresh reminder next cycle.
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
    .in('billing_status', ['none', 'past_due', 'cancelled'])
    .not('subscription_ends_at', 'is', null)
    .lt('subscription_ends_at', new Date().toISOString())
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const ids = (expired ?? []).map((c) => c.id as string)
  if (ids.length > 0) {
    await admin
      .from('cafes')
      .update({ status: 'suspended', status_reason: 'Subscription expired', status_changed_at: new Date().toISOString() })
      .in('id', ids)
  }

  let reminded = 0
  if (emailConfigured()) {
    const now = new Date()
    const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    const { data: expiringSoon } = await admin
      .from('cafes')
      .select('id, name, plan, owner_id, subscription_ends_at')
      .eq('status', 'active')
      .is('expiry_reminder_sent_at', null)
      .gte('subscription_ends_at', now.toISOString())
      .lte('subscription_ends_at', weekOut.toISOString())

    if (expiringSoon && expiringSoon.length > 0) {
      const ownerIds = [...new Set(expiringSoon.map((c) => c.owner_id).filter(Boolean))]
      const planKeys = [...new Set(expiringSoon.map((c) => c.plan).filter(Boolean))]
      const [{ data: owners }, { data: plans }] = await Promise.all([
        admin.from('profiles').select('id, email').in('id', ownerIds),
        admin.from('platform_plans').select('key, name').in('key', planKeys),
      ])
      const ownerEmail = new Map((owners ?? []).map((o) => [o.id as string, o.email as string | null]))
      const planName = new Map((plans ?? []).map((p) => [p.key as string, p.name as string]))

      for (const cafe of expiringSoon) {
        const email = ownerEmail.get(cafe.owner_id as string)
        if (!email) continue
        const endsAt = new Date(cafe.subscription_ends_at as string)
        const daysLeft = Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
        const expiresOn = endsAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
        const { subject, html, text } = planExpiryReminderEmail(
          cafe.name as string, planName.get(cafe.plan as string) ?? (cafe.plan as string), expiresOn, daysLeft,
        )
        const result = await sendEmail(email, subject, html, text)
        if (result.ok) {
          await admin.from('cafes').update({ expiry_reminder_sent_at: now.toISOString() }).eq('id', cafe.id)
          reminded++
        }
      }
    }
  }

  return NextResponse.json({ ok: true, suspended: ids.length, reminded })
}
