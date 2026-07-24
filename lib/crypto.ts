import crypto from 'crypto'

// SERVER ONLY. Symmetric encryption for café payment secrets at rest.
// PAYMENTS_ENC_KEY is a server env var (never NEXT_PUBLIC). Any strong
// passphrase works — it is hashed to a 32-byte key, so operators don't have
// to generate an exact 256-bit value.
const ENC_KEY = process.env.PAYMENTS_ENC_KEY ?? ''

export function encryptionConfigured(): boolean {
  return ENC_KEY.length >= 16
}

function keyBuffer(): Buffer {
  // Derive a stable 32-byte key from whatever passphrase is configured.
  return crypto.createHash('sha256').update(ENC_KEY).digest()
}

/**
 * AES-256-GCM. Output = base64(iv[12] ++ authTag[16] ++ ciphertext).
 * GCM's auth tag means a tampered ciphertext fails to decrypt rather than
 * silently returning garbage.
 */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer(), iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

export function decryptSecret(payload: string): string {
  const raw = Buffer.from(payload, 'base64')
  const iv = raw.subarray(0, 12)
  const tag = raw.subarray(12, 28)
  const enc = raw.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}
