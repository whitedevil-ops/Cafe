import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, adminConfigured } from '@/utils/supabase/admin'

// The local KhaoPiyo Print Bridge polls this for work.
//
// SECURITY SHAPE: the bridge holds a per-café bridge token and nothing else.
// It never sees a Supabase URL, anon key, or service-role key. This route is
// the only thing that touches Supabase, it runs server-side, and the RPC it
// calls resolves the token to exactly one cafe_id and filters every query by
// it — so a leaked bridge token exposes one café's kitchen tickets and cannot
// reach another café's data at all.
export async function POST(req: NextRequest) {
  const { token, limit } = (await req.json().catch(() => ({}))) as { token?: string; limit?: number }
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 })

  if (!adminConfigured()) {
    return NextResponse.json({ error: 'print service not configured on the server' }, { status: 503 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('bridge_claim_jobs', {
    p_token: token,
    p_limit: Math.min(Math.max(limit ?? 10, 1), 50),
  })

  // Deliberately vague: a bad token should not reveal whether it once existed.
  if (error) return NextResponse.json({ error: 'invalid bridge token' }, { status: 401 })

  return NextResponse.json(data)
}
