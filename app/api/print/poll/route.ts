import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, adminConfigured } from '@/utils/supabase/admin'

// The local KhaoPiyo Print Bridge polls this for work — but since desktop
// 1.2.2 only as a FALLBACK. The bridge now calls bridge_claim_jobs directly
// on the database (migration 0246), because this route was a Vercel Function
// Invocation every 4 seconds per paired PC: ~648K a month from one café, 65%
// of the Hobby plan's 1M quota. Keep this route: installs older than 1.2.2
// still use it, and a current install falls back to it when its network can't
// reach the database. See docs/print-bridge.md ("Direct polling").
//
// SECURITY SHAPE: the bridge's only secret is its per-café bridge token. It
// never holds the service-role key; this route does the privileged call
// server-side. The RPC resolves the token to exactly one cafe_id and filters
// every query by it — so a leaked bridge token exposes one café's kitchen
// tickets and cannot reach another café's data at all. (The direct path is
// gated by the same token check inside the function, not by the caller's role.)
export async function POST(req: NextRequest) {
  const { token, limit, app_version } = (await req.json().catch(() => ({}))) as {
    token?: string
    limit?: number
    /** The desktop app's own version, so support can see which build a café is
     *  actually running. Optional: a bridge older than this field simply omits
     *  it and keeps polling normally — which matters, because out-of-date
     *  bridges are exactly the ones this is meant to reveal. */
    app_version?: string
  }
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 })

  if (!adminConfigured()) {
    return NextResponse.json({ error: 'print service not configured on the server' }, { status: 503 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('bridge_claim_jobs', {
    p_token: token,
    p_limit: Math.min(Math.max(limit ?? 10, 1), 50),
    // Length-capped rather than trusted: this is client-supplied and lands in
    // a text column the admin panel renders.
    p_app_version: typeof app_version === 'string' ? app_version.trim().slice(0, 32) : null,
  })

  // Deliberately vague: a bad token should not reveal whether it once existed.
  if (error) return NextResponse.json({ error: 'invalid bridge token' }, { status: 401 })

  return NextResponse.json(data)
}
