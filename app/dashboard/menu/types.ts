export type MenuCategory = {
  id: string
  cafe_id: string
  name: string
  sort: number
  archived: boolean
}

export type MenuItemRow = {
  id: string
  cafe_id: string
  category_id: string | null
  name: string
  description: string | null
  price: number
  available: boolean
  is_veg: boolean | null
  is_bestseller: boolean
  sort: number
  archived: boolean
}
