import { supabase, isConfigured } from './supabase'
import { demoCafe, demoTables, demoMenu, demoOrders, demoOrderItems } from './demo'
import type { Cafe, CafeTable, MenuItem } from './types'

// SECURITY (audit F-01): `NewOrder`/`createOrder()` were removed. They accepted
// a client-supplied `total` and per-item `price` and inserted them directly.
// Orders are created only by place_order()/staff_place_order(), which price
// every line from the database; migration 0050 also revokes INSERT on
// orders/order_items from the anon and authenticated roles.
// `setOrderStatus()` was removed too — it mutated orders through the anon
// client; app/api/orders/[id] now performs that update as the signed-in user.

export async function getTableContext(
  token: string,
): Promise<{ cafe: Cafe; table: CafeTable; menu: MenuItem[] } | null> {
  if (!isConfigured) {
    const table = demoTables.find((t) => t.token === token)
    if (!table) return null
    return { cafe: demoCafe, table, menu: demoMenu }
  }

  const { data: table } = await supabase!
    .from('cafe_tables')
    .select('*')
    .eq('token', token)
    .single()
  if (!table) return null

  const [{ data: cafe }, { data: menu }] = await Promise.all([
    supabase!.from('cafes').select('*').eq('id', table.cafe_id).single(),
    supabase!
      .from('menu_items')
      .select('*')
      .eq('cafe_id', table.cafe_id)
      .eq('available', true)
      .order('sort'),
  ])
  if (!cafe) return null
  return { cafe, table, menu: menu ?? [] }
}

export type KdsRow = {
  order_id: string
  short_code: string
  created_at: string
  table_label: string
  paid: boolean
  items: { id: string; qty: number; name: string }[]
}

// Deliberately unauthenticated — this feeds the public, no-login kitchen
// display (/kds/[slug]). It calls the public_kds_orders() RPC (migration
// 0178) rather than selecting from `orders` directly: that table's RLS
// requires auth.uid() (is_cafe_member), which this screen never has by
// design, so a raw select here always silently returned zero rows. The RPC
// is SECURITY DEFINER and returns only what a kitchen board needs — no
// totals, no customer PII, no payment detail beyond a plain paid/unpaid flag.
export async function listOpenOrders(slug: string): Promise<KdsRow[]> {
  if (!isConfigured) {
    return demoOrders
      .filter((o) => o.status !== 'done' && o.status !== 'cancelled')
      .map((order) => ({
        order_id: order.id,
        short_code: order.short_code,
        created_at: order.created_at,
        table_label: demoTables.find((t) => t.id === order.table_id)?.label ?? '—',
        paid: order.payment_method === 'upi',
        items: demoOrderItems
          .filter((i) => i.order_id === order.id)
          .map((i) => ({ id: i.id, qty: i.qty, name: i.name })),
      }))
  }

  const { data } = await supabase!.rpc('public_kds_orders', { p_slug: slug })
  return (data as KdsRow[] | null) ?? []
}

// Marks a ticket done from the same unauthenticated kitchen display. Calls
// public_kds_advance_order() (migration 0178) — SECURITY DEFINER, re-derives
// the café from the slug and only allows the status forward into 'completed'
// from an open state, so a guessed/forged order id from another café can
// never be touched. Deliberately separate from PATCH /api/orders/[id], which
// requires a signed-in staff session (an earlier F-01 fix) that this
// no-login screen was never meant to carry.
export async function advanceKdsOrder(slug: string, orderId: string): Promise<{ ok: boolean; error?: string }> {
  if (!isConfigured) return { ok: true }
  const { error } = await supabase!.rpc('public_kds_advance_order', { p_slug: slug, p_order_id: orderId })
  return error ? { ok: false, error: error.message } : { ok: true }
}
