import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { cloudinaryConfigured, uploadToCloudinary } from '@/lib/cloudinary'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_PREFIXES = new Set(['item', 'logo', 'payqr'])
const MAX_BYTES = 2 * 1024 * 1024

// Server-mediated upload — Cloudinary has no per-folder RLS the way Supabase
// Storage did, so membership is checked here instead: only an authenticated
// member of the café the image is being uploaded for can write to it.
export async function POST(req: Request) {
  if (!cloudinaryConfigured()) {
    return NextResponse.json({ error: 'Image uploads are not configured.' }, { status: 503 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid upload.' }, { status: 400 })
  }

  const cafeId = String(form.get('cafeId') ?? '')
  const prefix = String(form.get('prefix') ?? '')
  const file = form.get('file')
  if (!cafeId || !ALLOWED_PREFIXES.has(prefix) || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'Invalid upload.' }, { status: 400 })
  }
  // Belt-and-braces: the browser already compresses below this, but a
  // request that skipped that step (or forged one) still can't get through.
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File is empty or too large.' }, { status: 400 })
  }

  // cafe_members has no id column — its primary key is the (cafe_id, user_id)
  // pair (schema.sql). Selecting 'id' made this query fail with PostgREST
  // 42703 on every single call; the destructure below dropped that error on
  // the floor, so the resulting null read as "not a member" 100% of the
  // time, for every café, on every image upload. cafe_id is a real column
  // and is all this needs to check for a matching row.
  const { data: membership } = await supabase
    .from('cafe_members')
    .select('cafe_id')
    .eq('cafe_id', cafeId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: 'Not authorized for this café.' }, { status: 403 })

  const publicId = `${prefix}-${crypto.randomUUID()}`
  const result = await uploadToCloudinary({ fileBlob: file, publicId, folder: `khaopiyo/${cafeId}` })
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 502 })

  return NextResponse.json({ url: result.url })
}
