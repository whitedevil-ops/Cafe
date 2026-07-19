import { NextRequest, NextResponse } from 'next/server'
import { createOrder, listOpenOrders, type NewOrder } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as NewOrder
    if (!body.items?.length) {
      return NextResponse.json({ error: 'Order has no items' }, { status: 400 })
    }
    const order = await createOrder(body)
    return NextResponse.json({ order })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug')
  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 })
  try {
    return NextResponse.json({ orders: await listOpenOrders(slug) })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
