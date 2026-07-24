import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let cafeId = ''
  try {
    const b = (await req.json()) as { cafe_id?: string }
    cafeId = String(b.cafe_id ?? '')
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (!cafeId) return NextResponse.json({ error: 'Missing café.' }, { status: 400 })

  const supabase = await createClient()
  const { error } = await supabase.rpc('disconnect_cafe_razorpay', { p_cafe_id: cafeId })
  if (error) {
    const status = /not authorized/i.test(error.message) ? 403 : 400
    return NextResponse.json({ error: error.message }, { status })
  }
  return NextResponse.json({ status: 'not_connected' })
}
