'use client'

import { createClient } from '@/utils/supabase/client'

const MAX_EDGE = 1024
const MAX_BYTES = 2 * 1024 * 1024

// Downscale + re-encode in the browser so a 5MB phone photo becomes a small webp
// before it ever leaves the device. Returns null if the file isn't a usable image.
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

  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', 0.82))
  if (blob && blob.size <= MAX_BYTES) return blob
  return null
}

// Uploads under the café's folder (RLS checks the first path segment) and
// returns the public URL, or an error message.
async function uploadToCafeFolder(
  cafeId: string,
  file: File,
  prefix: string,
): Promise<{ url: string } | { error: string }> {
  const blob = await compress(file)
  if (!blob) return { error: 'Please choose an image file (max 2MB after compression).' }

  const path = `${cafeId}/${prefix}-${crypto.randomUUID()}.webp`
  const supabase = createClient()
  const { error } = await supabase.storage
    .from('menu-images')
    .upload(path, blob, { contentType: 'image/webp', cacheControl: '31536000' })
  if (error) return { error: error.message }

  const { data } = supabase.storage.from('menu-images').getPublicUrl(path)
  return { url: data.publicUrl }
}

export function uploadMenuImage(cafeId: string, file: File) {
  return uploadToCafeFolder(cafeId, file, 'item')
}

export function uploadCafeLogo(cafeId: string, file: File) {
  return uploadToCafeFolder(cafeId, file, 'logo')
}
