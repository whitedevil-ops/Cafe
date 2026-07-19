import { supabase, isConfigured } from './supabase'
import { demoCafe, demoTables, demoMenu, demoOrders, demoOrderItems } from './demo'
import type { Cafe, CafeTable, MenuItem, Order, OrderItem, OrderStatus } from './types'

export type NewOrder = {
  cafe_id: string
  table_id: string | null
  phone: string | null
  total: number
  payment_method: 'upi' | 'counter'
  upsell_shown: boolean
  upsell_item_id: string | null
  upsell_taken: boolean
  upsell_value: number
  items: { menu_item_id: string; name: string; price: number; qty: number }[]
}

// Start of "today" in IST (UTC+5:30, no DST). Order numbers reset each morning, so the
// day boundary must be the cafe's local midnight, not UTC's.
function istDayStartISO(): string {
  const offsetMs = 5.5 * 60 * 60 * 1000
  const ist = new Date(Date.now() + offsetMs)
  ist.setUTCHours(0, 0, 0, 0)
  return new Date(ist.getTime() - offsetMs).toISOString()
}

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

export async function createOrder(input: NewOrder): Promise<Order> {
  const dayStart = istDayStartISO()

  if (!isConfigured) {
    // Plain daily sequence per cafe — the cook calls out "12", not a random "A47".
    // JS is single-threaded so this branch has no race.
    const seq =
      demoOrders.filter((o) => o.cafe_id === input.cafe_id && o.created_at >= dayStart).length + 1
    const order: Order = {
      id: `demo-order-${demoOrders.length + 1}`,
      cafe_id: input.cafe_id,
      table_id: input.table_id,
      short_code: String(seq),
      phone: input.phone,
      status: 'placed',
      total: input.total,
      payment_method: input.payment_method,
      upsell_shown: input.upsell_shown,
      upsell_item_id: input.upsell_item_id,
      upsell_taken: input.upsell_taken,
      upsell_value: input.upsell_value,
      created_at: new Date().toISOString(),
      done_at: null,
    }
    demoOrders.unshift(order)
    input.items.forEach((it, i) =>
      demoOrderItems.push({ id: `${order.id}-${i}`, order_id: order.id, ...it }),
    )
    return order
  }

  const { items, ...head } = input
  const { count } = await supabase!
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('cafe_id', input.cafe_id)
    .gte('created_at', dayStart)
  // ponytail: count+1 has a sub-second race if two tables pay simultaneously — at ~0.06
  // orders/sec (250/day) that's negligible. If it ever matters, move to an atomic
  // daily-counter table with an upsert; do not build that for a pilot.
  const seq = (count ?? 0) + 1

  const { data: order, error } = await supabase!
    .from('orders')
    .insert({ ...head, short_code: String(seq) })
    .select()
    .single()
  if (error) throw new Error(error.message)

  const { error: itemsError } = await supabase!
    .from('order_items')
    .insert(items.map((it) => ({ ...it, order_id: order.id })))
  if (itemsError) throw new Error(itemsError.message)

  return order
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

export async function setOrderStatus(id: string, status: OrderStatus): Promise<void> {
  const done_at = status === 'done' ? new Date().toISOString() : null

  if (!isConfigured) {
    const order = demoOrders.find((o) => o.id === id)
    if (order) {
      order.status = status
      order.done_at = done_at
    }
    return
  }

  const { error } = await supabase!.from('orders').update({ status, done_at }).eq('id', id)
  if (error) throw new Error(error.message)
}
