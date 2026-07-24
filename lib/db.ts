import { supabase, isConfigured } from './supabase'
import { demoCafe, demoTables, demoMenu, demoOrders, demoOrderItems } from './demo'
import type { Cafe, CafeTable, MenuItem, Order, OrderItem } from './types'

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

export type KdsRow = { order: Order; items: OrderItem[]; table_label: string }

export async function listOpenOrders(slug: string): Promise<KdsRow[]> {
  if (!isConfigured) {
    return demoOrders
      .filter((o) => o.status !== 'done' && o.status !== 'cancelled')
      .map((order) => ({
        order,
        items: demoOrderItems.filter((i) => i.order_id === order.id),
        table_label: demoTables.find((t) => t.id === order.table_id)?.label ?? '—',
      }))
  }

  const { data: cafe } = await supabase!.from('cafes').select('id').eq('slug', slug).single()
  if (!cafe) return []

  const { data: orders } = await supabase!
    .from('orders')
    .select('*')
    .eq('cafe_id', cafe.id)
    .in('status', ['placed', 'preparing', 'ready'])
    .order('created_at', { ascending: true })
  if (!orders?.length) return []

  const tableIds = [...new Set(orders.map((o) => o.table_id).filter(Boolean))] as string[]
  const [{ data: items }, { data: tables }] = await Promise.all([
    supabase!
      .from('order_items')
      .select('*')
      .in(
        'order_id',
        orders.map((o) => o.id),
      ),
    tableIds.length
      ? supabase!.from('cafe_tables').select('id,label').in('id', tableIds)
      : Promise.resolve({ data: [] as { id: string; label: string }[] }),
  ])
  const labelOf = new Map((tables ?? []).map((t) => [t.id, t.label]))

  return orders.map((order) => ({
    order,
    items: (items ?? []).filter((i) => i.order_id === order.id),
    table_label: (order.table_id && labelOf.get(order.table_id)) || '—',
  }))
}
