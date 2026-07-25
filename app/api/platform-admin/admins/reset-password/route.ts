import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

// Same shape as /api/platform-admin/reset-owner-password: never sees,
// generates, or stores a password — triggers the same resetPasswordForEmail()
// magic-link flow an admin would use themselves from "forgot password".
export async function POST(req: NextRequest) {
  const { admin_id } = (await req.json().catch(() => ({}))) as { admin_id?: string }
  if (!admin_id) return NextResponse.json({ error: 'admin_id required' }, { status: 400 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: detail, error: detailError } = await supabase.rpc('op_get_admin_detail', { p_admin_id: admin_id })
  if (detailError) return NextResponse.json({ error: detailError.message }, { status: 403 })
  const target = detail as { email: string | null } | null
  if (!target?.email) return NextResponse.json({ error: 'admin has no email on file' }, { status: 400 })

  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const { error } = await supabase.auth.resetPasswordForEmail(target.email, { redirectTo: `${base}/login` })

  await supabase.rpc('op_log_admin_password_reset', {
    p_admin_id: admin_id,
    p_target_email: target.email,
    p_status: error ? 'failed' : 'sent',
    p_error: error?.message ?? null,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, email: target.email })
}
