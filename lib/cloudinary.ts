import crypto from 'crypto'

// SERVER ONLY. Cloudinary secrets live exclusively in environment variables —
// never NEXT_PUBLIC, never the client bundle. Importing this into a client
// component would fail the build, which is the intended guard.
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME ?? ''
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY ?? ''
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET ?? ''

export function cloudinaryConfigured(): boolean {
  return Boolean(CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET)
}

/** Cloudinary's signature algorithm: sort every signed param, join as
 *  key=value&key=value, append the API secret directly (no separator), SHA-1
 *  hex digest. Same "sign server-side with a secret, verify Cloudinary's own
 *  side" shape as the Razorpay webhook signature elsewhere in this codebase. */
function sign(params: Record<string, string>): string {
  const joined = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&')
  return crypto.createHash('sha1').update(joined + CLOUDINARY_API_SECRET).digest('hex')
}

export async function uploadToCloudinary(params: {
  fileBlob: Blob
  publicId: string
  folder: string
}): Promise<{ url: string } | { error: string }> {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const signature = sign({ timestamp, folder: params.folder, public_id: params.publicId })

  const form = new FormData()
  form.append('file', params.fileBlob)
  form.append('api_key', CLOUDINARY_API_KEY)
  form.append('timestamp', timestamp)
  form.append('signature', signature)
  form.append('folder', params.folder)
  form.append('public_id', params.publicId)

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { error: `Cloudinary upload failed (${res.status}): ${body.slice(0, 200)}` }
  }
  const data = (await res.json()) as { secure_url?: string }
  return data.secure_url ? { url: data.secure_url } : { error: 'Cloudinary response missing secure_url' }
}
