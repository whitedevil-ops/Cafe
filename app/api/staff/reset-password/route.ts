import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient, adminConfigured } from '@/utils/supabase/admin'

// Sets a staff member's password directly — no email, no reset link. The
// owner/manager types the new password here and it goes straight to
// Supabase Auth's service-role admin API, same shape as /api/staff/create.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    cafe_id?: string
    user_id?: string
    password?: string
    confirm_password?: string
  }
  const cafe_id = body.cafe_id ?? ''
  const target_user_id = body.user_id ?? ''
  const password = body.password ?? ''

  if (!cafe_id || !target_user_id) return NextResponse.json({ error: 'cafe_id and user_id are required' }, { status: 400 })
  if (password.length < 8) return NextResponse.json({ error: 'password must be at least 8 characters' }, { status: 400 })
  if (password !== body.confirm_password) return NextResponse.json({ error: 'passwords do not match' }, { status: 400 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: allowed } = await supabase.rpc('has_cafe_role', { target: cafe_id, roles: ['owner', 'manager'] })
  if (!allowed) return NextResponse.json({ error: 'only an owner or manager can reset staff passwords' }, { status: 403 })

  // RLS ("member read") already scopes this to the caller's own café — this
  // also confirms the target is actually a member here, not just any user_id.
  const { data: target } = await supabase
    .from('cafe_members')
    .select('role')
    .eq('cafe_id', cafe_id)
    .eq('user_id', target_user_id)
    .maybeSingle()
  if (!target) return NextResponse.json({ error: 'not a member of this café' }, { status: 404 })
  if (target.role === 'owner') {
    return NextResponse.json({ error: "an owner's password can't be reset from here — use Sign in > Forgot password." }, { status: 403 })
  }

  if (!adminConfigured()) {
    return NextResponse.json({ error: 'Password reset is not configured on this server (missing service role key).' }, { status: 503 })
  }

  const admin = createAdminClient()
  const { error } = await admin.auth.admin.updateUserById(target_user_id, { password })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ ok: true })
}
