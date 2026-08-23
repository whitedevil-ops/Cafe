import { NextRequest, NextResponse } from 'next/server'

// Meta's WhatsApp Cloud API webhook — required to complete the app's
// "Production setup" in Meta for Developers, even before any message-sending
// code exists. Two jobs, exactly what Meta's setup flow needs today:
//
// GET  — the one-time verification handshake Meta performs when you click
//        "Verify and save" against the Callback URL. Meta sends
//        ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=..., and
//        expects the raw challenge string echoed back, in PLAIN TEXT (not
//        JSON) — wrapping it breaks verification.
// POST — where Meta delivers real events afterward (incoming messages,
//        delivery/read status updates). No send-side feature exists yet to
//        act on these, so this just logs and acknowledges — Meta requires a
//        fast 200 regardless of whether the payload was otherwise consumed,
//        or it will disable the webhook and retry aggressively.
//
// WHATSAPP_VERIFY_TOKEN is a shared secret set here AND pasted into Meta's
// "Verify token" field — it is not a WhatsApp/Meta-issued value, it's one we
// mint ourselves so only Meta's real handshake (which must echo it back) can
// pass this check.
export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get('hub.mode')
  const token = req.nextUrl.searchParams.get('hub.verify_token')
  const challenge = req.nextUrl.searchParams.get('hub.challenge')

  const expected = process.env.WHATSAPP_VERIFY_TOKEN
  if (!expected) {
    return NextResponse.json({ error: 'WHATSAPP_VERIFY_TOKEN is not set in this deployment.' }, { status: 500 })
  }
  if (mode === 'subscribe' && token === expected && challenge) {
    return new NextResponse(challenge, { status: 200 })
  }
  return NextResponse.json({ error: 'verification failed' }, { status: 403 })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  // No message-sending feature exists yet to correlate these against, so
  // this is deliberately just visibility into what Meta is delivering —
  // check Vercel's function logs for this route while testing.
  console.log('[whatsapp webhook]', JSON.stringify(body))
  return NextResponse.json({ ok: true })
}
