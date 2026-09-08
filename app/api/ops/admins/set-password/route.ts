import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient, adminConfigured } from '@/utils/supabase/admin'

// Directly sets another admin's password from the Ops panel — bypasses the
// email-reset flow entirely (no proof the target actually owns that inbox).
// Restricted to super_admin, stricter than the "send reset email" button
// beside it (admins.edit): unlike a reset link, which only the target's own
// inbox can complete, this briefly puts the new password in the acting
// admin's hands too, so it deserves a tighter gate.
//
// Logged through the same password_reset_log / op_log_admin_password_reset
// path as the email flow, with status 'set_directly' instead of 'sent' so
// the audit trail still tells the two apart.
export async function POST(req: NextRequest) {
  const { admin_id, new_password } = (await req.json().catch(() => ({}))) as { admin_id?: string; new_password?: string }
  if (!admin_id) return NextResponse.json({ error: 'admin_id required' }, { status: 400 })
  if (!new_password || new_password.length < 8) {
    return NextResponse.json({ error: 'password must be at least 8 characters' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: context } = await supabase.rpc('platform_admin_context')
  const ctx = context as { role: string } | null
  if (ctx?.role !== 'super_admin') {
    return NextResponse.json({ error: 'only a super admin can set another admin\'s password directly' }, { status: 403 })
  }

  const { data: detail, error: detailError } = await supabase.rpc('op_get_admin_detail', { p_admin_id: admin_id })
  if (detailError) return NextResponse.json({ error: detailError.message }, { status: 403 })
  const target = detail as { user_id: string | null; email: string | null } | null
  if (!target?.user_id) return NextResponse.json({ error: 'admin not found' }, { status: 404 })

  if (!adminConfigured()) {
    return NextResponse.json({ error: 'Direct password changes are not configured on this server (missing service role key).' }, { status: 503 })
  }

  const admin = createAdminClient()
  const { error } = await admin.auth.admin.updateUserById(target.user_id, { password: new_password })

  const { error: logError } = await supabase.rpc('op_log_admin_password_reset', {
    p_admin_id: admin_id,
    p_target_email: target.email ?? '',
    p_status: error ? 'failed' : 'set_directly',
    p_error: error?.message ?? null,
  })
  if (logError) return NextResponse.json({ error: `password set but failed to log: ${logError.message}` }, { status: 500 })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
