import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import { verifyWebhookSignature, verifyPaymentSignature } from '@/lib/razorpay'

// The webhook signature is the single thing that makes an online payment
// trustworthy. These prove the verification accepts only a body genuinely
// signed with the secret — a forged or tampered webhook is rejected — which
// is what stops "frontend says success → PAID" from ever being possible.
describe('razorpay webhook signature verification', () => {
  const secret = 'whsec_test_123'
  const body = JSON.stringify({
    event: 'payment.captured',
    payload: { payment: { entity: { id: 'pay_X', order_id: 'order_X', amount: 84700 } } },
  })
  const goodSig = crypto.createHmac('sha256', secret).update(body).digest('hex')

  it('accepts a body correctly signed with the secret', () => {
    expect(verifyWebhookSignature(body, goodSig, secret)).toBe(true)
  })
  it('rejects a body tampered with after signing (amount changed)', () => {
    const tampered = body.replace('84700', '100')
    expect(verifyWebhookSignature(tampered, goodSig, secret)).toBe(false)
  })
  it('rejects a signature made with a different secret', () => {
    const wrong = crypto.createHmac('sha256', 'not_the_secret').update(body).digest('hex')
    expect(verifyWebhookSignature(body, wrong, secret)).toBe(false)
  })
  it('rejects a missing signature', () => {
    expect(verifyWebhookSignature(body, null, secret)).toBe(false)
  })
  it('rejects a wrong-length forged signature without throwing', () => {
    expect(verifyWebhookSignature(body, 'deadbeef', secret)).toBe(false)
  })
  it('rejects when no secret is configured', () => {
    expect(verifyWebhookSignature(body, goodSig, '')).toBe(false)
  })
})

describe('razorpay checkout handshake signature', () => {
  const secret = 'key_secret_abc'
  const good = crypto.createHmac('sha256', secret).update('order_9|pay_9').digest('hex')

  it('verifies the exact order|payment pair', () => {
    expect(verifyPaymentSignature('order_9', 'pay_9', good, secret)).toBe(true)
  })
  it('rejects a different payment id against the same signature', () => {
    expect(verifyPaymentSignature('order_9', 'pay_OTHER', good, secret)).toBe(false)
  })
})
