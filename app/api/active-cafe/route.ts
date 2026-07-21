import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

// Sets the workspace-switcher cookie. Validates the café id against the caller's
// own memberships before storing — the cookie can only ever name a café the user
// actually belongs to (and getCurrentCafe re-validates on every read anyway).
export async function POST(req: NextRequest) {
  const { cafe_id } = (await req.json().catch(() => ({}))) as { cafe_id?: string }
  if (!cafe_id) return NextResponse.json({ error: 'cafe_id required' }, { status: 400 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: membership } = await supabase
    .from('cafe_members')
    .select('cafe_id')
    .eq('user_id', user.id)
    .eq('cafe_id', cafe_id)
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: 'not a member' }, { status: 403 })

  const res = NextResponse.json({ ok: true })
  res.cookies.set('active_cafe', cafe_id, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  })
  return res
}
