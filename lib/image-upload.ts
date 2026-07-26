'use client'

const MAX_EDGE = 1024
const MAX_BYTES = 2 * 1024 * 1024

// Downscale + re-encode in the browser so any phone photo — 1MB, 10MB,
// whatever the camera produces — becomes a small webp before it ever leaves
// the device. The resize to MAX_EDGE already does most of the work (a
// 12MP photo becomes ~1MP), but a single fixed quality could still miss on
// an unusually detailed image, so quality steps down until it actually
// fits rather than rejecting the upload. Returns null only if the file
// isn't a usable image at all.
async function compress(file: File): Promise<Blob | null> {
  if (!file.type.startsWith('image/')) return null
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) return null

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()

  for (const quality of [0.82, 0.7, 0.6, 0.5, 0.4, 0.3]) {
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', quality))
    if (blob && blob.size <= MAX_BYTES) return blob
  }
  return null
}

// Compresses client-side, then hands off to the server (/api/images/upload),
// which checks café membership and uploads to Cloudinary — Cloudinary has no
// per-folder RLS the way Supabase Storage did, so that check has to happen
// server-side instead of being enforced by a storage policy.
async function uploadToCafeFolder(
  cafeId: string,
  file: File,
  prefix: string,
): Promise<{ url: string } | { error: string }> {
  const blob = await compress(file)
  if (!blob) return { error: 'Please choose an image file (max 2MB after compression).' }

  const form = new FormData()
  form.append('cafeId', cafeId)
  form.append('prefix', prefix)
  form.append('file', blob, `${prefix}.webp`)

  const res = await fetch('/api/images/upload', { method: 'POST', body: form })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) return { error: body.error ?? 'Upload failed.' }
  return { url: body.url as string }
}

export function uploadMenuImage(cafeId: string, file: File) {
  return uploadToCafeFolder(cafeId, file, 'item')
}

export function uploadCafeLogo(cafeId: string, file: File) {
  return uploadToCafeFolder(cafeId, file, 'logo')
}

export function uploadPaymentQr(cafeId: string, file: File) {
  return uploadToCafeFolder(cafeId, file, 'payqr')
}
