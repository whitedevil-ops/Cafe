import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, adminConfigured } from '@/utils/supabase/admin'
import { sendSms, smsConfigured, otpSmsText } from '@/lib/sms'

// Issues a one-time code so a customer can unlock their OWN order history.
// The code is generated inside Postgres (out of reach of the anon role),
// returned only to this server route, and delivered by SMS. It is never in
// the HTTP response, so possession of the handset is the only way to get it.
export async function POST(req: NextRequest) {
  const { table_token, phone } = (await req.json().catch(() => ({}))) as {
    table_token?: string
    phone?: string
  }
  if (!table_token || !phone) {
    return NextResponse.json({ error: 'table_token and phone are required' }, { status: 400 })
  }

  // Refuse honestly rather than storing a code nobody can receive, which would
  // leave the customer staring at a code box that can never be satisfied.
  if (!adminConfigured() || !smsConfigured()) {
    return NextResponse.json(
      { error: 'Order history is temporarily unavailable — phone verification is not configured yet.' },
      { status: 503 },
    )
  }

  const admin = createAdminClient()

  // IP-side half of the OTP throttle — customer_issue_otp already limits by
  // PHONE (3/15min); this stops the same attack rotating through many phone
  // numbers from one IP to exhaust the café's SMS budget. Vercel's proxy sets
  // x-forwarded-for itself, overwriting anything a client tries to send, so
  // this header is trustworthy here even though it wouldn't be from a
  // browser-supplied value.
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
  // Opportunistic cleanup — keeps the table small without needing its own cron.
  void admin.from('otp_ip_attempts').delete().lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

  // This route holds the service-role key, so it could still read the token
  // column directly after migration 0132 — but it goes through the same
  // resolver as every other caller so there is exactly one place that maps a
  // token to a café, and no service-role query that quietly depends on a
  // privilege the rest of the app no longer has.
  const { data: resolved } = await admin.rpc('resolve_table_token', { p_token: table_token })
  const cafeName = (resolved as { cafe_name?: string } | null)?.cafe_name ?? 'the café'

  const { data, error } = await admin.rpc('customer_issue_otp', {
    p_table_token: table_token,
    p_phone: phone,
  })
  if (error) {
    // Rate-limit / validation messages from the RPC are safe to surface.
    return NextResponse.json({ error: error.message }, { status: 429 })
  }

  const code = (data as { code?: string })?.code
  if (!code) {
    return NextResponse.json({ error: 'Could not issue a verification code.' }, { status: 500 })
  }

  const result = await sendSms(phone, otpSmsText(cafeName, code))
  if (!result.ok) {
    return NextResponse.json(
      { error: 'Could not send the verification code. Please try again shortly.' },
      { status: 502 },
    )
  }

  return NextResponse.json({ ok: true })
}
