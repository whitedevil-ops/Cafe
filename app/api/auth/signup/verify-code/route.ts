import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, adminConfigured } from '@/utils/supabase/admin'
import { sendEmail, emailConfigured, welcomeEmail } from '@/lib/email'

// Verifies the code from /request-code, spends the invite token (0197),
// then creates the Supabase user directly with email_confirm: true —
// bypassing Supabase Auth's own magic-link mailer entirely, same pattern
// app/api/staff/create/route.ts already uses. The account is only created
// AFTER the code is proven correct and the invite is confirmed unused, so
// there is no unconfirmed "ghost" account left behind if someone abandons
// mid-verification. Password/name/phone are never persisted server-side —
// they travel in this one request only.
//
// terms_version (0231, T&C consent-flow audit): the signup form now only
// sets `agreed` after the visitor actually scrolls the Terms of Service to
// the bottom and clicks Agree in the modal — but there is no user_id to
// attach that acceptance to until createUser below succeeds. So the version
// string travels through this request and gets written to legal_acceptances
// here, right after the account exists, using the admin client (the new
// user has no session yet to call the normal authenticated RPC with).
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    email?: string
    code?: string
    full_name?: string
    phone?: string
    password?: string
    token?: string
    terms_version?: string
  }
  const email = (body.email ?? '').trim().toLowerCase()
  const { code, full_name, phone, password, token, terms_version } = body
  if (!email || !code || !full_name || !password) {
    return NextResponse.json({ error: 'email, code, full_name and password are required' }, { status: 400 })
  }
  if (!token) {
    return NextResponse.json({ error: 'This is an invite-only signup link.' }, { status: 400 })
  }
  if (!terms_version) {
    return NextResponse.json({ error: 'Please agree to the Terms of Service to continue.' }, { status: 400 })
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

  // Spend the invite atomically, right before creating the account — a race
  // between two completions of the same token resolves to one success and
  // one "already been used", never two accounts off one invite.
  const { error: consumeErr } = await admin.rpc('consume_signup_invite', { p_token: token, p_email: email })
  if (consumeErr) {
    return NextResponse.json({ error: consumeErr.message }, { status: 400 })
  }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, phone: phone || null },
  })
  if (createErr) {
    return NextResponse.json({ error: createErr.message }, { status: 400 })
  }

  // Best-effort in the same sense as the welcome email below: the account
  // already exists at this point, so a failure here must not fail the whole
  // signup. Unlike the email, though, this is the one legally meaningful
  // side effect of the checkbox the visitor just completed — log it loudly
  // (server console, picked up by Vercel/Sentry) rather than swallow it
  // silently, so a persistent failure here is actually noticeable.
  if (created.user) {
    const { error: acceptErr } = await admin
      .from('legal_acceptances')
      .insert({ user_id: created.user.id, doc_type: 'terms', doc_version: terms_version })
    if (acceptErr) {
      console.error('signup: failed to record terms acceptance', { userId: created.user.id, error: acceptErr })
    }
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
