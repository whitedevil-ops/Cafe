import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

// Operator-triggered password reset. Never sees, generates, or stores a
// password — it calls the SAME resetPasswordForEmail() flow a café owner
// would use themselves from "forgot password", just triggered on their
// behalf.
//
// Gated on cafes.reset_password — a narrower permission than cafes.edit,
// separate since Phase 4, so a Support Admin can reset a café owner's
// password (an explicit part of that role) without also getting full café
// edit rights. Checked BEFORE the reset email fires, not just inside the
// logging RPC.
export async function POST(req: NextRequest) {
  const { cafe_id } = (await req.json().catch(() => ({}))) as { cafe_id?: string }
  if (!cafe_id) return NextResponse.json({ error: 'cafe_id required' }, { status: 400 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: canReset } = await supabase.rpc('has_platform_permission', { p_permission: 'cafes.reset_password' })
  if (!canReset) return NextResponse.json({ error: 'not authorized' }, { status: 403 })

  const { data: cafe } = await supabase.from('cafes').select('owner_id').eq('id', cafe_id).maybeSingle()
  if (!cafe) return NextResponse.json({ error: 'cafe not found' }, { status: 404 })

  const { data: owner } = await supabase.from('profiles').select('id, email').eq('id', cafe.owner_id).maybeSingle()
  if (!owner?.email) return NextResponse.json({ error: 'owner has no email on file' }, { status: 400 })

  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://khaopiyo.ventron.in'
  const { error } = await supabase.auth.resetPasswordForEmail(owner.email, { redirectTo: `${base}/login` })

  const { error: logError } = await supabase.rpc('op_log_password_reset', {
    p_cafe_id: cafe_id,
    p_target_user_id: owner.id,
    p_target_email: owner.email,
    p_status: error ? 'failed' : 'sent',
    p_error: error?.message ?? null,
  })
  if (logError) return NextResponse.json({ error: `reset sent but failed to log: ${logError.message}` }, { status: 500 })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, email: owner.email })
}
