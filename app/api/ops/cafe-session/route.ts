import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

// Starts and ends an operator café session (migration 0134).
//
// Authorization is NOT decided here. op_begin_cafe_session() re-checks
// has_platform_permission('cafes.impersonate') itself and raises if the caller
// lacks it, so this route can be a thin wrapper rather than a second, drifting
// copy of the rule. What the route uniquely owns is the cookie: a hint that
// lets lib/cafe.ts skip the session lookup for the ~all visitors who are café
// staff. It is httpOnly so page scripts can't read it, but it grants nothing
// on its own — forging it just triggers an RPC that returns null.
const HINT = 'kp_ops_session'

export async function POST(req: NextRequest) {
  const { cafe_id, reason, minutes } = (await req.json().catch(() => ({}))) as {
    cafe_id?: string
    reason?: string
    minutes?: number
  }
  if (!cafe_id) return NextResponse.json({ error: 'cafe_id required' }, { status: 400 })
  if (!reason?.trim()) {
    return NextResponse.json({ error: 'Give a reason for opening this café.' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data, error } = await supabase.rpc('op_begin_cafe_session', {
    p_cafe_id: cafe_id,
    p_reason: reason.trim(),
    p_minutes: minutes ?? 60,
  })
  if (error) {
    // 'not authorized' is the RPC's own permission refusal — map it to 403 so
    // the client can tell "you may not" apart from "it went wrong".
    const denied = error.message.includes('not authorized')
    return NextResponse.json({ error: error.message }, { status: denied ? 403 : 400 })
  }

  const session = data as { expires_at: string; cafe_name: string }
  const res = NextResponse.json({ ok: true, ...session })
  res.cookies.set(HINT, '1', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    // Matches the session's own lifetime, so the hint disappears on its own
    // when the session expires rather than lingering and costing every later
    // request a pointless lookup.
    expires: new Date(session.expires_at),
  })
  return res
}

export async function DELETE() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // op_end_cafe_session() intentionally has no permission check — ending your
  // own session must keep working even for an admin whose access was revoked
  // mid-session, who would otherwise be stuck inside the café.
  const { error } = await supabase.rpc('op_end_cafe_session')
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const res = NextResponse.json({ ok: true })
  res.cookies.set(HINT, '', { httpOnly: true, path: '/', maxAge: 0 })
  return res
}
