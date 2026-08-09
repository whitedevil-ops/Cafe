import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import {
  readMenuFromImages,
  visionProvider,
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  type MenuImage,
} from '@/lib/menu-vision'

// Reads a café's menu out of photographs of it.
//
// Server-side only, because the vision API key must never reach a browser and
// because a paid call needs an authenticated owner behind it. The route returns
// rows, not menu records: the client feeds them through parseMenuFile and the
// owner confirms the same preview an uploaded file produces. Nothing here
// writes to the database.
//
// Env-gated in the same shape as the Razorpay routes — with no key set the
// endpoint reports 503 and the button never appears, rather than half-working.

export const maxDuration = 60

/** base64 decodes to roughly 3/4 of its own length. */
const decodedBytes = (b64: string) => Math.floor((b64.length * 3) / 4)

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    cafe_id?: string
    images?: { mediaType?: string; data?: string }[]
  }
  const cafeId = body.cafe_id ?? ''
  const raw = Array.isArray(body.images) ? body.images : []

  if (!cafeId) return NextResponse.json({ error: 'cafe_id is required' }, { status: 400 })
  if (raw.length === 0) return NextResponse.json({ error: 'Add at least one photo of the menu.' }, { status: 400 })
  if (raw.length > MAX_IMAGES) {
    return NextResponse.json({ error: `Up to ${MAX_IMAGES} photos at a time.` }, { status: 400 })
  }

  const images: MenuImage[] = []
  for (const img of raw) {
    const mediaType = String(img?.mediaType ?? '')
    const data = String(img?.data ?? '')
    if (!ACCEPTED_IMAGE_TYPES.includes(mediaType)) {
      return NextResponse.json({ error: 'Photos must be JPEG, PNG, WebP or GIF.' }, { status: 400 })
    }
    if (!data) return NextResponse.json({ error: 'One of the photos was empty.' }, { status: 400 })
    if (decodedBytes(data) > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: 'Each photo must be under 5 MB.' }, { status: 400 })
    }
    images.push({ mediaType, data })
  }

  // Authenticated owner/manager of THIS café — same gate as every other
  // menu-writing action, checked before spending a paid API call.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: allowed } = await supabase.rpc('has_cafe_role', { target: cafeId, roles: ['owner', 'manager'] })
  if (!allowed) {
    return NextResponse.json({ error: 'Only an owner or manager can scan a menu.' }, { status: 403 })
  }

  if (!visionProvider(process.env)) {
    return NextResponse.json(
      { error: 'Menu scanning is not switched on for this server.' },
      { status: 503 },
    )
  }

  try {
    const { rows, items } = await readMenuFromImages(images, process.env)
    return NextResponse.json({ ok: true, rows, items })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not read that menu.'
    // Never surface a provider's raw error — it can carry request details.
    const safe = /^(Menu scanning|No menu items)/.test(message)
      ? message
      : 'Could not read that menu. Try a sharper, straight-on photo.'
    return NextResponse.json({ error: safe }, { status: 502 })
  }
}

/** Lets the client show the button only when the server can actually scan. */
export async function GET() {
  return NextResponse.json({ available: visionProvider(process.env) !== null })
}
