import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient, adminConfigured } from '@/utils/supabase/admin'

// Directly changes a café owner's or staff member's login email from the
// Ops panel — bypasses Supabase's normal "confirm from the new address"
// email-change flow entirely. Restricted to super_admin, stricter than
// cafes.reset_password/cafes.edit: a password reset only proves you still
// own the CURRENT email; this changes which email that even is, with
// nothing to stop a typo or malicious address from silently redirecting
// that account's login and recovery.
export async function POST(req: NextRequest) {
  const { cafe_id, target_user_id, new_email, old_email } = (await req.json().catch(() => ({}))) as {
    cafe_id?: string
    target_user_id?: string
    new_email?: string
    old_email?: string | null
  }
  if (!cafe_id) return NextResponse.json({ error: 'cafe_id required' }, { status: 400 })
  const email = (new_email ?? '').trim().toLowerCase()
  if (!email || !email.includes('@')) return NextResponse.json({ error: 'enter a valid email address' }, { status: 400 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: context } = await supabase.rpc('platform_admin_context')
  const ctx = context as { role: string } | null
  if (ctx?.role !== 'super_admin') {
    return NextResponse.json({ error: "only a super admin can change a member's email directly" }, { status: 403 })
  }

  let targetId = target_user_id
  if (!targetId) {
    const { data: cafe } = await supabase.from('cafes').select('owner_id').eq('id', cafe_id).maybeSingle()
    if (!cafe) return NextResponse.json({ error: 'cafe not found' }, { status: 404 })
    targetId = cafe.owner_id
  } else {
    const { data: membership } = await supabase.from('cafe_members').select('user_id').eq('cafe_id', cafe_id).eq('user_id', targetId).maybeSingle()
    if (!membership) return NextResponse.json({ error: 'that person is not a member of this café' }, { status: 404 })
  }
  if (!targetId) return NextResponse.json({ error: 'could not resolve the target user' }, { status: 404 })

  if (!adminConfigured()) {
    return NextResponse.json({ error: 'Direct email changes are not configured on this server (missing service role key).' }, { status: 503 })
  }

  const admin = createAdminClient()
  const { error: authError } = await admin.auth.admin.updateUserById(targetId, { email, email_confirm: true })
  if (authError) return NextResponse.json({ error: authError.message }, { status: 500 })

  // profiles.email is a denormalized copy read everywhere in the app
  // (op_list_users, the café Users & Staff list, etc.) — there's no trigger
  // syncing it on an auth.users UPDATE (only 0001's handle_new_user, which
  // only fires on INSERT), so it silently keeps showing the old address
  // forever unless updated here too. Uses the service-role client, not the
  // caller's own session — RLS on profiles only lets a user write their own
  // row, not another member's.
  const { error: profileError } = await admin.from('profiles').update({ email }).eq('id', targetId)

  const { error: logError } = await supabase.rpc('op_log_member_email_changed', {
    p_cafe_id: cafe_id,
    p_target_user_id: targetId,
    p_old_email: old_email ?? null,
    p_new_email: email,
  })

  if (profileError) return NextResponse.json({ error: `auth email changed but profile update failed: ${profileError.message}` }, { status: 500 })
  if (logError) return NextResponse.json({ error: `email changed but failed to log: ${logError.message}` }, { status: 500 })

  return NextResponse.json({ ok: true, email })
}
