import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

// Same shape as /api/ops/reset-owner-password: never sees,
// generates, or stores a password — triggers the same resetPasswordForEmail()
// magic-link flow an admin would use themselves from "forgot password".
//
// Gated on admins.edit (the same permission the "Reset password" button
// itself is hidden behind, admins-client.tsx) — checked BEFORE the reset
// email fires. Previously the only real gate was op_get_admin_detail's own
// admins.view check (inherited indirectly, not admins.edit as the UI
// implies), so an admin with only view rights could force a reset email to
// any other admin, including a super_admin.
export async function POST(req: NextRequest) {
  const { admin_id } = (await req.json().catch(() => ({}))) as { admin_id?: string }
  if (!admin_id) return NextResponse.json({ error: 'admin_id required' }, { status: 400 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: canEdit } = await supabase.rpc('has_platform_permission', { p_permission: 'admins.edit' })
  if (!canEdit) return NextResponse.json({ error: 'not authorized' }, { status: 403 })

  const { data: detail, error: detailError } = await supabase.rpc('op_get_admin_detail', { p_admin_id: admin_id })
  if (detailError) return NextResponse.json({ error: detailError.message }, { status: 403 })
  const target = detail as { email: string | null } | null
  if (!target?.email) return NextResponse.json({ error: 'admin has no email on file' }, { status: 400 })

  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://khaopiyo.ventron.in'
  const { error } = await supabase.auth.resetPasswordForEmail(target.email, { redirectTo: `${base}/login` })

  const { error: logError } = await supabase.rpc('op_log_admin_password_reset', {
    p_admin_id: admin_id,
    p_target_email: target.email,
    p_status: error ? 'failed' : 'sent',
    p_error: error?.message ?? null,
  })
  if (logError) return NextResponse.json({ error: `reset sent but failed to log: ${logError.message}` }, { status: 500 })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, email: target.email })
}
