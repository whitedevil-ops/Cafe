export type MenuCategory = {
  id: string
  cafe_id: string
  name: string
  sort: number
  archived: boolean
  /** Routes this category's items to a kitchen printer bound to that
   * station. Null means "every printer with no station of its own". */
  station_id: string | null
}

export type MenuItemRow = {
  id: string
  cafe_id: string
  category_id: string | null
  name: string
  description: string | null
  price: number
  image_url: string | null
  available: boolean
  is_veg: boolean | null
  is_bestseller: boolean
  sort: number
  archived: boolean
  cost: number | null
  cost_source: 'manual' | 'recipe'
  /** Today's Offer — see saveItem()/the "Today's Offer" drawer block.
   *  Both null means no offer configured. Baseline, every-plan feature — not
   *  gated by hasFeature(). offer_days is 0=Sunday..6=Saturday. */
  offer_price: number | null
  offer_days: number[] | null
}
