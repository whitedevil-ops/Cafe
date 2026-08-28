import { NextRequest, NextResponse } from 'next/server'
import { advanceKdsOrder } from '@/lib/db'

export const dynamic = 'force-dynamic'

// Deliberately unauthenticated — the counterpart to GET /api/orders?slug=,
// serving the public, no-login kitchen display (/kds/[slug]). Do not point
// this at PATCH /api/orders/[id] (that route correctly requires a signed-in
// staff session per an earlier F-01 security fix); this route instead calls
// public_kds_advance_order(), which re-derives the café from the slug itself
// and only allows the forward transition into 'completed'.
export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params
  const { orderId } = (await req.json().catch(() => ({}))) as { orderId?: string }
  if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 })

  const result = await advanceKdsOrder(slug, orderId)
  if (!result.ok) return NextResponse.json({ error: result.error ?? 'could not update this order' }, { status: 400 })
  return NextResponse.json({ ok: true })
}
