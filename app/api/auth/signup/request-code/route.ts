import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, adminConfigured } from '@/utils/supabase/admin'
import { sendEmail, emailConfigured, signupCodeEmail } from '@/lib/email'

// Issues a 6-character alphanumeric code so a new café owner proves they
// control the email address BEFORE an account is created for it. The code
// is generated inside Postgres (out of reach of the anon role), returned
// only to this server route, and delivered by email — never in the HTTP
// response. Mirrors app/api/customer/request-otp/route.ts's shape.
export async function POST(req: NextRequest) {
  const rawBody = (await req.json().catch(() => ({}))) as { email?: string; token?: string }
  const email = (rawBody.email ?? '').trim().toLowerCase()
  const token = (rawBody.token ?? '').trim()
  if (!email) {
    return NextResponse.json({ error: 'email is required' }, { status: 400 })
  }
  if (!token) {
    return NextResponse.json({ error: 'This is an invite-only signup link.' }, { status: 400 })
  }

  if (!adminConfigured() || !emailConfigured()) {
    return NextResponse.json(
      { error: 'Signup is temporarily unavailable — email verification is not configured yet.' },
      { status: 503 },
    )
  }

  const admin = createAdminClient()

  // Re-validate the invite before spending an OTP issuance on it — a
  // request with an invalid/expired/wrong-email token should never reach
  // the point of actually emailing a code.
  const { data: inviteData, error: inviteErr } = await admin.rpc('resolve_signup_invite', { p_token: token })
  if (inviteErr) {
    return NextResponse.json({ error: inviteErr.message }, { status: 400 })
  }
  if ((inviteData as { email?: string } | null)?.email !== email) {
    return NextResponse.json({ error: 'This signup link is for a different email address.' }, { status: 400 })
  }

  // Same IP-throttle table and threshold as customer OTP requests — this
  // is a shared "an OTP was requested from this IP" budget, not specific
  // to one flow.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString()
  const { count: recentFromIp } = await admin
    .from('otp_ip_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('ip', ip)
    .gte('created_at', fifteenMinAgo)
  if ((recentFromIp ?? 0) >= 8) {
    return NextResponse.json(
      { error: 'Too many verification codes requested from this connection — please wait a few minutes.' },
      { status: 429 },
    )
  }
  void admin.from('otp_ip_attempts').insert({ ip })
  void admin.from('otp_ip_attempts').delete().lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

  const { data, error } = await admin.rpc('issue_signup_otp', { p_email: email })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 429 })
  }

  const code = (data as { code?: string })?.code
  if (!code) {
    return NextResponse.json({ error: 'Could not issue a verification code.' }, { status: 500 })
  }

  const { subject, html, text } = signupCodeEmail(code)
  const result = await sendEmail(email, subject, html, text)
  if (!result.ok) {
    return NextResponse.json(
      { error: 'Could not send the verification code. Please try again shortly.' },
      { status: 502 },
    )
  }

  return NextResponse.json({ ok: true })
}
