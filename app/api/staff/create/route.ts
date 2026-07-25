import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient, adminConfigured } from '@/utils/supabase/admin'

const ROLES = ['manager', 'cashier', 'kitchen', 'waiter', 'accountant']

// Creates a brand-new staff login directly — the owner/manager types the
// password here and it goes straight to Supabase Auth's service-role admin
// API, same shape as /api/platform-admin/admins/create. No invite row, no
// email, no signup link: create_staff_member (called after) does the
// authorized cafe_members write and re-checks the seat cap independently.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    cafe_id?: string
    full_name?: string
    email?: string
    password?: string
    confirm_password?: string
    role?: string
  }
  const cafe_id = body.cafe_id ?? ''
  const full_name = (body.full_name ?? '').trim()
  const email = (body.email ?? '').trim().toLowerCase()
  const password = body.password ?? ''
  const role = body.role ?? ''

  if (!cafe_id) return NextResponse.json({ error: 'cafe_id is required' }, { status: 400 })
  if (!full_name) return NextResponse.json({ error: 'full name is required' }, { status: 400 })
  if (!email || !email.includes('@')) return NextResponse.json({ error: 'enter a valid email address' }, { status: 400 })
  if (!ROLES.includes(role)) return NextResponse.json({ error: 'invalid role' }, { status: 400 })
  if (password.length < 8) return NextResponse.json({ error: 'password must be at least 8 characters' }, { status: 400 })
  if (password !== body.confirm_password) return NextResponse.json({ error: 'passwords do not match' }, { status: 400 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // Cheap pre-check before touching the service-role API — create_staff_member
  // re-checks role + seat cap again independently once called.
  const { data: allowed } = await supabase.rpc('has_cafe_role', { target: cafe_id, roles: ['owner', 'manager'] })
  if (!allowed) return NextResponse.json({ error: 'only an owner or manager can add staff' }, { status: 403 })

  if (!adminConfigured()) {
    return NextResponse.json({ error: 'Staff account creation is not configured on this server (missing service role key).' }, { status: 503 })
  }

  const admin = createAdminClient()
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  })
  if (createError || !created.user) {
    const message = /already.*registered|already.*exists/i.test(createError?.message ?? '')
      ? 'An account with this email already exists. This form only creates brand-new logins.'
      : (createError?.message ?? 'could not create account')
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const { data: member, error: rpcError } = await supabase.rpc('create_staff_member', {
    p_cafe_id: cafe_id,
    p_user_id: created.user.id,
    p_role: role,
  })

  if (rpcError) {
    // Don't leave a login-capable orphan account with no membership row.
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {})
    return NextResponse.json({ error: rpcError.message }, { status: 400 })
  }

  return NextResponse.json({
    ok: true,
    member: { userId: created.user.id, name: full_name, email, role: (member as { role: string }).role },
  })
}
