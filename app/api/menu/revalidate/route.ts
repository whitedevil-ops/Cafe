import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createClient } from '@/utils/supabase/server'
import { menuCacheTag } from '@/lib/menu-cache-tag'

// Drops one café's cached menu catalog — the customer QR menu (lib/menu-cache.ts)
// and the POS catalog (lib/pos-cache.ts) both carry this tag.
//
// The dashboard's menu editors write straight from the browser to Supabase, and
// revalidateTag only works from a Route Handler or Server Action, so they call
// this right after a write succeeds. Without it a saved change waits on
// unstable_cache's stale-while-revalidate window, during which the first load
// still gets the OLD menu — see the measurements in lib/menu-cache.ts.
//
// `{ expire: 0 }` (not 'max') on purpose: 'max' keeps serving the stale entry
// once more while it refreshes, which is exactly the "saved it, still not
// there" behaviour this endpoint exists to remove. Expiring makes the very
// next request rebuild from the database.
//
// Safe to expose to any active member: it only expires a cache for a café the
// caller already belongs to (the worst a hostile member can do is cost their
// own café one extra rebuild per call), and the café id is checked against the
// caller's real membership rather than trusted.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { cafe_id?: unknown }
  const cafeId = typeof body.cafe_id === 'string' ? body.cafe_id : ''
  if (!UUID.test(cafeId)) return NextResponse.json({ error: 'cafe_id is required' }, { status: 400 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: member } = await supabase.rpc('is_cafe_member', { target: cafeId })
  if (member !== true) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  revalidateTag(menuCacheTag(cafeId), { expire: 0 })
  return NextResponse.json({ ok: true })
}
