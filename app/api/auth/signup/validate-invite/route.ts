import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, adminConfigured } from '@/utils/supabase/admin'

// Resolves an invite token to the email it was issued for, before the
// signup page renders any form. Never validates against anon Postgres
// directly — resolve_signup_invite is service_role-only, called here via
// the admin client, same posture as issue_signup_otp/verify_signup_otp.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { token?: string }
  const token = (body.token ?? '').trim()
  if (!token) {
    return NextResponse.json(
      { error: 'This is an invite-only signup link — the link you used is missing its invite code.' },
      { status: 400 },
    )
  }

  if (!adminConfigured()) {
    return NextResponse.json(
      { error: 'Signup is temporarily unavailable — please try again shortly.' },
      { status: 503 },
    )
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('resolve_signup_invite', { p_token: token })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  const email = (data as { email?: string } | null)?.email
  if (!email) {
    return NextResponse.json({ error: 'This signup link is not valid.' }, { status: 400 })
  }

  return NextResponse.json({ email })
}
