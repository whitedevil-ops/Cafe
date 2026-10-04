import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import MenuManager from './menu-manager'
import type { MenuCategory, MenuItemRow } from './types'

export const dynamic = 'force-dynamic'

export default async function MenuPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()
  // Categories and items are all the plain item list needs for first paint.
  // Combos, kitchen stations, and item-editor-only data (the sizes' names and
  // margins, the inventory entitlement) are fetched lazily client-side once
  // their own panel is actually opened — see menu-manager.tsx and
  // combos-panel.tsx.
  //
  // The one exception is each item's sizes' PRICE DELTAS, embedded in the same
  // query (no extra round trip): the list shows an item sold in sizes at its
  // lowest price, which needs nothing else about them.
  const [{ data: categories }, { data: items }] = await Promise.all([
    supabase.from('menu_categories').select('*').eq('cafe_id', cafe.cafeId).order('sort'),
    supabase.from('menu_items').select('*, menu_item_variants(price_delta)').eq('cafe_id', cafe.cafeId).order('sort'),
  ])

  return (
    <MenuManager
      cafeId={cafe.cafeId}
      cafeName={cafe.name}
      role={cafe.role}
      initialCategories={(categories ?? []) as MenuCategory[]}
      initialItems={(items ?? []) as MenuItemRow[]}
    />
  )
}
