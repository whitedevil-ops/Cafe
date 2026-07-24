import { NextRequest, NextResponse } from 'next/server'
import { listOpenOrders } from '@/lib/db'

export const dynamic = 'force-dynamic'

// SECURITY (audit F-01 follow-up): the former POST handler created an order
// from a request body that carried its own `total` and per-item `price`, then
// inserted straight into `orders`/`order_items`. That is a client-supplied
// money path and the exact opposite of this system's rule that every rupee is
// computed server-side. It had no callers (the KDS only reads), and it is now
// removed. Orders are created ONLY by the validated RPCs:
//   place_order()        — anonymous QR customer, priced from the DB
//   staff_place_order()  — authenticated staff, priced from the DB
// Migration 0050 additionally revokes INSERT on orders/order_items from the
// anon and authenticated roles, so no such path can be reintroduced by mistake.

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug')
  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 })
  try {
    return NextResponse.json({ orders: await listOpenOrders(slug) })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
