import { describe, it, expect, beforeAll } from 'vitest'

// Set the key BEFORE importing the module — it reads the env var at load time.
beforeAll(() => {
  process.env.PAYMENTS_ENC_KEY = 'test-passphrase-for-encryption-1234567890'
})

describe('payment secret encryption (AES-256-GCM)', () => {
  it('round-trips a secret unchanged', async () => {
    const { encryptSecret, decryptSecret } = await import('@/lib/crypto')
    const secret = 'rzp_live_SECRETkey_abcdef123456'
    const enc = encryptSecret(secret)
    expect(enc).not.toContain(secret) // ciphertext never contains the plaintext
    expect(decryptSecret(enc)).toBe(secret)
  })

  it('produces a different ciphertext each time (random IV)', async () => {
    const { encryptSecret } = await import('@/lib/crypto')
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'))
  })

  it('fails to decrypt a tampered ciphertext (auth tag)', async () => {
    const { encryptSecret, decryptSecret } = await import('@/lib/crypto')
    const enc = encryptSecret('do-not-tamper')
    const raw = Buffer.from(enc, 'base64')
    raw[raw.length - 1] ^= 0xff // flip a byte in the ciphertext
    expect(() => decryptSecret(raw.toString('base64'))).toThrow()
  })
})
