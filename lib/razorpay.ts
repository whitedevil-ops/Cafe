import crypto from 'crypto'

// SERVER ONLY. Razorpay secrets live exclusively in environment variables —
// never NEXT_PUBLIC, never the client bundle. These reads are safe in server
// routes; importing this file into a client component would fail the build,
// which is the intended guard.
export const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID ?? ''
export const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET ?? ''
export const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET ?? ''

/** Online payments are only operational once the platform's Razorpay Route
 *  credentials are present. Without them every online path returns 503 — the
 *  café falls back to pay-at-counter, never a broken button. */
export function razorpayConfigured(): boolean {
  return Boolean(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET)
}
export function webhookConfigured(): boolean {
  return Boolean(RAZORPAY_WEBHOOK_SECRET)
}

/**
 * Verify a Razorpay webhook signature: HMAC-SHA256 of the RAW request body
 * keyed by the webhook secret, hex-encoded, compared in constant time.
 * This is the ONLY thing that makes a webhook trustworthy — a request whose
 * signature doesn't verify is discarded, no matter what its body claims.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  // timingSafeEqual throws on length mismatch — guard so a wrong-length forged
  // signature returns false instead of erroring.
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

/**
 * Verify the checkout success handshake (order_id|payment_id signed with the
 * key secret). Used as UX confirmation only — the authoritative state change
 * still comes from the verified webhook.
 */
export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false
  const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

/** Create a Razorpay order on a specific café's account via the REST API
 *  (Basic auth = that café's key_id:key_secret). amount is in paise. */
export async function createRazorpayOrder(params: {
  keyId: string
  keySecret: string
  amountPaise: number
  receipt: string
  notes?: Record<string, string>
}): Promise<{ id: string } | { error: string }> {
  const auth = Buffer.from(`${params.keyId}:${params.keySecret}`).toString('base64')
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      amount: params.amountPaise,
      currency: 'INR',
      receipt: params.receipt,
      notes: params.notes ?? {},
    }),
  })
  if (!res.ok) return { error: `razorpay order failed (${res.status})` }
  const body = (await res.json()) as { id?: string }
  return body.id ? { id: body.id } : { error: 'razorpay order missing id' }
}
