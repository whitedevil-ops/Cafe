import type { Cafe, CafeTable, MenuItem, Order, OrderItem } from './types'

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

const m = (
  id: string,
  category: string,
  name: string,
  price: number,
  sort: number,
  is_upsell = false,
  upsell_pitch: string | null = null,
): MenuItem => ({
  id,
  cafe_id: demoCafe.id,
  category,
  name,
  price,
  image_url: null,
  available: true,
  sort,
  is_upsell,
  upsell_pitch,
})

export const demoMenu: MenuItem[] = [
  m('i1', 'Coffee', 'Cappuccino', 140, 1),
  m('i2', 'Coffee', 'Cafe Latte', 150, 2),
  m('i3', 'Coffee', 'Cold Coffee', 180, 3),
  m('i4', 'Coffee', 'Espresso', 110, 4),
  m('i5', 'Coffee', 'Hazelnut Latte', 190, 5),
  m('i6', 'Tea', 'Masala Chai', 70, 6),
  m('i7', 'Tea', 'Green Tea', 90, 7),
  m('i8', 'Food', 'Veg Sandwich', 160, 8),
  m('i9', 'Food', 'Paneer Tikka Roll', 190, 9),
  m('i10', 'Food', 'Peri Peri Fries', 130, 10),
  m('i11', 'Food', 'Maggi Masala', 110, 11),
  m('i12', 'Bakery', 'Chocolate Brownie', 60, 12, true, 'Add a warm brownie'),
  m('i13', 'Bakery', 'Choco Chip Cookie', 40, 13, true, 'Add a cookie'),
  m('i14', 'Bakery', 'Banana Bread', 70, 14, true, 'Add a slice of banana bread'),
]

export const demoOrders: Order[] = []
export const demoOrderItems: OrderItem[] = []
