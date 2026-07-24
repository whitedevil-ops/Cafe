import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Superseded by the per-café endpoint /api/payments/razorpay/webhook/[token].
// Each café configures its own token-scoped webhook URL, verified with that
// café's own webhook secret. This platform-level path is no longer used.
export async function POST() {
  return NextResponse.json(
    { error: 'Use the per-café webhook URL shown in the café’s payment settings.' },
    { status: 410 },
  )
}
