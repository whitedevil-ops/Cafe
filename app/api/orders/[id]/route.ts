import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export const dynamic = 'force-dynamic'

// Advances a kitchen ticket's operational status.
//
// SECURITY (audit F-01 follow-up): this previously called lib/db's
// setOrderStatus(), which uses the plain ANON client — an unauthenticated
// endpoint that attempted to mutate orders. It was only ever stopped by RLS.
// It now runs as the CALLER: the session cookie is required, RLS scopes the
// update to cafés the user belongs to, and migration 0050's column grant means
// even this path can only touch `status`/`done_at` — never totals or
// payment_status.
// The database `order_status` enum — deliberately not lib/types' legacy
// OrderStatus, which predates the current schema. Anything outside this
// allow-list is rejected before it reaches Postgres.
const ALLOWED = ['placed', 'accepted', 'preparing', 'ready', 'served', 'completed', 'cancelled'] as const
type AllowedStatus = (typeof ALLOWED)[number]

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const { status } = (await req.json().catch(() => ({}))) as { status?: AllowedStatus }

  if (!status || !ALLOWED.includes(status)) {
    return NextResponse.json({ error: 'invalid status' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('orders')
    .update({ status, done_at: status === 'completed' ? new Date().toISOString() : null })
    .eq('id', id)

  // RLS/grants decide — a member of another café simply matches no rows.
  if (error) return NextResponse.json({ error: 'could not update this order' }, { status: 403 })
  return NextResponse.json({ ok: true })
}
