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

  const { data: tableRow } = await admin
    .from('cafe_tables')
    .select('cafes(name)')
    .eq('token', table_token)
    .maybeSingle()
  const cafeRow = Array.isArray(tableRow?.cafes) ? tableRow.cafes[0] : tableRow?.cafes
  const cafeName = cafeRow?.name ?? 'the café'

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
