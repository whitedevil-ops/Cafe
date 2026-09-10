import type { Cafe, CafeTable, Order, OrderItem } from './types'

// In-memory store so `npm run dev` works with zero setup. Dev convenience only —
// state lives in the dev server process and dies with it. Real pilots run on Supabase.

export const demoCafe: Cafe = {
  id: 'demo-cafe',
  slug: 'brew-room',
  name: 'The Brew Room',
  logo_url: null,
  upi_id: 'brewroom@okhdfcbank',
  upi_name: 'The Brew Room',
  upsell_threshold: 150,
}

export const demoTables: CafeTable[] = ['1', '2', '3', '4', '5', '6'].map((label) => ({
  id: `demo-table-${label}`,
  cafe_id: demoCafe.id,
  label,
  token: `brew-t${label}`,
}))

export const demoOrders: Order[] = []
export const demoOrderItems: OrderItem[] = []
