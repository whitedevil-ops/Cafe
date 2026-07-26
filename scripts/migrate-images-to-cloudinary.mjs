// One-off admin script: move existing menu item photos + café logo from
// Supabase Storage to Cloudinary, and update the image_url columns to point
// at the new location. Existing Supabase Storage objects are left in place
// (not deleted) — this only stops referencing them, so nothing is lost if
// something needs to be rolled back.
//
// Run with:
//   node --env-file=.env.local scripts/migrate-images-to-cloudinary.mjs [--cafe=<uuid>] [--dry-run]

import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET
if (!SUPABASE_URL || !SERVICE_KEY || !CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or CLOUDINARY_* vars in env.')
  process.exit(1)
}

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const cafeArg = args.find((a) => a.startsWith('--cafe='))
const CAFE_ID = cafeArg ? cafeArg.slice('--cafe='.length) : 'c0ffee00-0000-4000-a000-000000000001'

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

function sign(params) {
  const joined = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&')
  return crypto.createHash('sha1').update(joined + CLOUDINARY_API_SECRET).digest('hex')
}

async function uploadToCloudinary(buf, publicId, folder) {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const signature = sign({ timestamp, folder, public_id: publicId })

  const form = new FormData()
  form.append('file', new Blob([buf]))
  form.append('api_key', CLOUDINARY_API_KEY)
  form.append('timestamp', timestamp)
  form.append('signature', signature)
  form.append('folder', folder)
  form.append('public_id', publicId)

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) return { error: `Cloudinary upload failed (${res.status}): ${(await res.text()).slice(0, 200)}` }
  const data = await res.json()
  return data.secure_url ? { url: data.secure_url } : { error: 'Cloudinary response missing secure_url' }
}

async function migrateOne(sourceUrl, publicId, folder) {
  const res = await fetch(sourceUrl)
  if (!res.ok) return { error: `source fetch failed (${res.status})` }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length === 0) return { error: 'source image is empty' }
  return uploadToCloudinary(buf, publicId, folder)
}

async function run() {
  const { data: cafe } = await supabase.from('cafes').select('id, logo_url').eq('id', CAFE_ID).maybeSingle()
  if (!cafe) throw new Error('café not found')

  const { data: items } = await supabase
    .from('menu_items')
    .select('id, name, image_url')
    .eq('cafe_id', CAFE_ID)
    .eq('archived', false)
    .not('image_url', 'is', null)
  const supabaseItems = (items ?? []).filter((i) => i.image_url.includes('supabase.co'))

  console.log(`${supabaseItems.length} item photos + ${cafe.logo_url?.includes('supabase.co') ? 1 : 0} logo to migrate. ${DRY_RUN ? '(dry run)' : ''}`)

  let ok = 0
  let failed = 0

  if (cafe.logo_url?.includes('supabase.co')) {
    const result = await migrateOne(cafe.logo_url, `logo-${cafe.id}`, `khaopiyo/${cafe.id}`)
    if ('error' in result) {
      console.warn(`✗ logo — ${result.error}`)
      failed++
    } else {
      console.log(`✓ logo`)
      if (!DRY_RUN) await supabase.from('cafes').update({ logo_url: result.url }).eq('id', cafe.id)
      ok++
    }
  }

  for (const item of supabaseItems) {
    const result = await migrateOne(item.image_url, `item-${item.id}`, `khaopiyo/${cafe.id}`)
    if ('error' in result) {
      console.warn(`✗ ${item.name} — ${result.error}`)
      failed++
      continue
    }
    console.log(`✓ ${item.name}`)
    if (!DRY_RUN) await supabase.from('menu_items').update({ image_url: result.url }).eq('id', item.id)
    ok++
    await new Promise((r) => setTimeout(r, 150))
  }

  console.log(`\nDone. ${ok} migrated, ${failed} failed.`)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
