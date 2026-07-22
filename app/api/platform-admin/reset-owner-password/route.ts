import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

// Operator-triggered password reset. Never sees, generates, or stores a
// password — it calls the SAME resetPasswordForEmail() flow a café owner
// would use themselves from "forgot password", just triggered on their
// behalf. Server-side is_platform_admin() is the only gate; the RPC that
// logs this also re-checks it independently.
export async function POST(req: NextRequest) {
  const { cafe_id } = (await req.json().catch(() => ({}))) as { cafe_id?: string }
  if (!cafe_id) return NextResponse.json({ error: 'cafe_id required' }, { status: 400 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: isAdmin } = await supabase.rpc('is_platform_admin')
  if (!isAdmin) return NextResponse.json({ error: 'not authorized' }, { status: 403 })

  const { data: cafe } = await supabase.from('cafes').select('owner_id').eq('id', cafe_id).maybeSingle()
  if (!cafe) return NextResponse.json({ error: 'cafe not found' }, { status: 404 })

  const { data: owner } = await supabase.from('profiles').select('id, email').eq('id', cafe.owner_id).maybeSingle()
  if (!owner?.email) return NextResponse.json({ error: 'owner has no email on file' }, { status: 400 })

  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const { error } = await supabase.auth.resetPasswordForEmail(owner.email, { redirectTo: `${base}/login` })

  await supabase.rpc('op_log_password_reset', {
    p_cafe_id: cafe_id,
    p_target_user_id: owner.id,
    p_target_email: owner.email,
    p_status: error ? 'failed' : 'sent',
    p_error: error?.message ?? null,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, email: owner.email })
}
