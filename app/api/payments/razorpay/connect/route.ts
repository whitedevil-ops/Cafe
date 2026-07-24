import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { encryptionConfigured, encryptSecret } from '@/lib/crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// A café connects ITS OWN Razorpay account. The secret + webhook secret are
// encrypted here (server-side) before they ever touch the database, and are
// never returned to any client. Authorization is enforced by the
// set_cafe_razorpay RPC (owner/manager of that café only).
export async function POST(req: Request) {
  if (!encryptionConfigured()) {
    return NextResponse.json(
      { error: 'Payment encryption is not configured on the server. Set PAYMENTS_ENC_KEY.' },
      { status: 503 },
    )
  }

  let cafeId = '', keyId = '', keySecret = '', webhookSecret = ''
  try {
    const b = (await req.json()) as { cafe_id?: string; key_id?: string; key_secret?: string; webhook_secret?: string }
    cafeId = String(b.cafe_id ?? '')
    keyId = String(b.key_id ?? '').trim()
    keySecret = String(b.key_secret ?? '').trim()
    webhookSecret = String(b.webhook_secret ?? '').trim()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  if (!cafeId || !keyId || !keySecret) {
    return NextResponse.json({ error: 'Key ID and Key Secret are required.' }, { status: 400 })
  }
  if (!/^rzp_(live|test)_[A-Za-z0-9]+$/.test(keyId)) {
    return NextResponse.json({ error: 'That does not look like a Razorpay Key ID (rzp_live_… or rzp_test_…).' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  // Encrypt before storage. The RPC (SECURITY DEFINER, owner/manager-gated)
  // performs the actual write and returns the stable webhook routing token.
  const { data: token, error } = await supabase.rpc('set_cafe_razorpay', {
    p_cafe_id: cafeId,
    p_key_id: keyId,
    p_key_secret_enc: encryptSecret(keySecret),
    p_webhook_secret_enc: webhookSecret ? encryptSecret(webhookSecret) : null,
  })
  if (error) {
    const status = /not authorized/i.test(error.message) ? 403 : 400
    return NextResponse.json({ error: error.message }, { status })
  }

  const origin = new URL(req.url).origin
  return NextResponse.json({
    status: 'connected',
    webhook_url: `${origin}/api/payments/razorpay/webhook/${token}`,
  })
}
