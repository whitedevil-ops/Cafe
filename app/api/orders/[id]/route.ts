import { NextRequest, NextResponse } from 'next/server'
import { setOrderStatus } from '@/lib/db'
import type { OrderStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    const { status } = (await req.json()) as { status: OrderStatus }
    await setOrderStatus(id, status)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
