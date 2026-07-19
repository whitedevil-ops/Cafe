export type OrderStatus = 'placed' | 'preparing' | 'ready' | 'done' | 'cancelled'

export type Cafe = {
  id: string
  slug: string
  name: string
  logo_url: string | null
  upi_id: string | null
  upi_name: string | null
  upsell_threshold: number
}

export type CafeTable = {
  id: string
  cafe_id: string
  label: string
  token: string
}

export type MenuItem = {
  id: string
  cafe_id: string
  category: string
  name: string
  price: number
  image_url: string | null
  available: boolean
  sort: number
  is_upsell: boolean
  upsell_pitch: string | null
}

export type Order = {
  id: string
  cafe_id: string
  table_id: string | null
  short_code: string
  phone: string | null
  status: OrderStatus
  total: number
  payment_method: 'upi' | 'counter' | null
  upsell_shown: boolean
  upsell_item_id: string | null
  upsell_taken: boolean
  upsell_value: number
  created_at: string
  done_at: string | null
}

export type OrderItem = {
  id: string
  order_id: string
  menu_item_id: string | null
  name: string
  price: number
  qty: number
}

export type CartLine = { item: MenuItem; qty: number }
