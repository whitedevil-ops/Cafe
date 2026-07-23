import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import FloorClient, { type FloorTable } from './floor-client'
import type { MenuCategory, MenuItem, MenuVariant, MenuAddon } from '@/components/waiter/quick-add-sheet'

export const dynamic = 'force-dynamic'

export default async function TablesFloorPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()
  const [{ data }, { data: categories }, { data: items }] = await Promise.all([
    supabase.from('cafe_tables').select('id, label, capacity, status').eq('cafe_id', cafe.cafeId),
    supabase.from('menu_categories').select('id, name, sort').eq('cafe_id', cafe.cafeId).order('sort'),
    supabase
      .from('menu_items')
      .select('id, name, price, category_id, available')
      .eq('cafe_id', cafe.cafeId)
      .eq('archived', false)
      .order('sort'),
  ])

  const itemIds = (items ?? []).map((i) => i.id)
  const [{ data: variants }, { data: addons }] = await Promise.all([
    itemIds.length
      ? supabase.from('menu_item_variants').select('id, menu_item_id, name, price_delta').in('menu_item_id', itemIds).order('sort')
      : Promise.resolve({ data: [] }),
    itemIds.length
      ? supabase.from('menu_item_addons').select('id, menu_item_id, name, price').in('menu_item_id', itemIds).order('sort')
      : Promise.resolve({ data: [] }),
  ])

  return (
    <FloorClient
      cafeId={cafe.cafeId}
      timezone={cafe.timezone}
      initialTables={(data ?? []) as FloorTable[]}
      menu={{
        categories: (categories ?? []) as MenuCategory[],
        items: (items ?? []) as MenuItem[],
        variants: (variants ?? []) as MenuVariant[],
        addons: (addons ?? []) as MenuAddon[],
      }}
    />
  )
}
