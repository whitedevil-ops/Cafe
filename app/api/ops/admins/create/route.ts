import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient, adminConfigured } from '@/utils/supabase/admin'

const ROLES = ['super_admin', 'operations_admin', 'support_admin', 'billing_admin', 'read_only', 'sales_admin']

// Creates a brand-new operator-console login. The password the Super Admin
// types here is sent straight to Supabase Auth's service-role admin API and
// never touches our own tables — op_create_admin (called after) only records
// the roster row (name/email/role/permissions), never a credential.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    full_name?: string
    email?: string
    password?: string
    confirm_password?: string
    role?: string
    permissions?: Record<string, boolean>
  }
  const full_name = (body.full_name ?? '').trim()
  const email = (body.email ?? '').trim().toLowerCase()
  const password = body.password ?? ''
  const role = body.role ?? ''
  const permissions = body.permissions ?? {}

  if (!full_name) return NextResponse.json({ error: 'full name is required' }, { status: 400 })
  if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 })
  if (!ROLES.includes(role)) return NextResponse.json({ error: 'invalid role' }, { status: 400 })
  if (password.length < 8) return NextResponse.json({ error: 'password must be at least 8 characters' }, { status: 400 })
  if (password !== body.confirm_password) return NextResponse.json({ error: 'passwords do not match' }, { status: 400 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // Cheap, side-effect-free pre-check before touching the service-role API —
  // op_create_admin re-checks all of this again independently once called.
  const { data: context } = await supabase.rpc('platform_admin_context')
  const ctx = context as { role: string; permissions: Record<string, boolean> } | null
  if (!ctx?.permissions?.['admins.create']) return NextResponse.json({ error: 'not authorized' }, { status: 403 })
  if (role === 'super_admin' && ctx.role !== 'super_admin') {
    return NextResponse.json({ error: 'only a super admin can create another super admin' }, { status: 403 })
  }

  if (!adminConfigured()) {
    return NextResponse.json({ error: 'Admin account creation is not configured on this server (missing service role key).' }, { status: 503 })
  }

  const admin = createAdminClient()
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  })
  if (createError || !created.user) {
    return NextResponse.json({ error: createError?.message ?? 'could not create account' }, { status: 400 })
  }

  const { data: adminId, error: rpcError } = await supabase.rpc('op_create_admin', {
    p_user_id: created.user.id,
    p_full_name: full_name,
    p_email: email,
    p_role: role,
    p_permissions: permissions,
  })

  if (rpcError) {
    // Don't leave a login-capable orphan account with no roster row.
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {})
    return NextResponse.json({ error: rpcError.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true, admin_id: adminId })
}
