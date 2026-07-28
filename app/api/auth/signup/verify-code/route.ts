import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, adminConfigured } from '@/utils/supabase/admin'
import { sendEmail, emailConfigured, welcomeEmail } from '@/lib/email'

// Verifies the code from /request-code, then creates the Supabase user
// directly with email_confirm: true — bypassing Supabase Auth's own
// magic-link mailer entirely, same pattern app/api/staff/create/route.ts
// already uses. The account is only created AFTER the code is proven
// correct, so there is no unconfirmed "ghost" account left behind if
// someone abandons mid-verification. Password/name/phone are never
// persisted server-side — they travel in this one request only.
export async function POST(req: NextRequest) {
  const { email, code, full_name, phone, password } = (await req.json().catch(() => ({}))) as {
    email?: string
    code?: string
    full_name?: string
    phone?: string
    password?: string
  }
  if (!email || !code || !full_name || !password) {
    return NextResponse.json({ error: 'email, code, full_name and password are required' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
  }

  if (!adminConfigured()) {
    return NextResponse.json(
      { error: 'Signup is temporarily unavailable — please try again shortly.' },
      { status: 503 },
    )
  }

  const admin = createAdminClient()

  const { error: verifyErr } = await admin.rpc('verify_signup_otp', { p_email: email, p_code: code })
  if (verifyErr) {
    return NextResponse.json({ error: verifyErr.message }, { status: 400 })
  }

  const { error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, phone: phone || null },
  })
  if (createErr) {
    return NextResponse.json({ error: createErr.message }, { status: 400 })
  }

  // Best-effort — the account is already created at this point, so a welcome
  // email failing (quota, transient provider error) must never surface as a
  // signup failure to the new owner. Still awaited (not fire-and-forget):
  // serverless functions can be frozen right after the response is sent, so
  // an un-awaited send here could simply never complete.
  if (emailConfigured()) {
    const { subject, html, text } = welcomeEmail(full_name)
    await sendEmail(email, subject, html, text)
  }

  return NextResponse.json({ ok: true })
}
