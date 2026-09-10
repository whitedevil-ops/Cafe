import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import { hasFeature } from '@/lib/entitlements'
import FloorClient, { type FloorTable } from './floor-client'
import type { MenuCategory, MenuItem, MenuVariant, MenuAddon } from '@/components/waiter/quick-add-sheet'

export const dynamic = 'force-dynamic'

export default async function TablesFloorPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  if (!(await hasFeature(cafe.cafeId, 'live_tables'))) {
    redirect('/dashboard')
  }

  const supabase = await createClient()
  // sms_bills only needs cafe.cafeId, same as the four queries beside it —
  // it used to sit in the second Promise.all purely because it was written
  // next to variants/addons, which forced it to wait out a whole extra
  // round-trip (items) it never actually depended on.
  const [{ data }, { data: areas }, { data: categories }, { data: items }, smsBillsEnabled, waiterQuickAddEnabled] = await Promise.all([
    supabase.from('cafe_tables').select('id, label, capacity, status, area_id').eq('cafe_id', cafe.cafeId).eq('archived', false),
    supabase.from('floor_areas').select('id, name').eq('cafe_id', cafe.cafeId).eq('archived', false).order('sort'),
    supabase.from('menu_categories').select('id, name, sort').eq('cafe_id', cafe.cafeId).order('sort'),
    supabase
      .from('menu_items')
      .select('id, name, price, category_id, available')
      .eq('cafe_id', cafe.cafeId)
      .eq('archived', false)
      .order('sort'),
    hasFeature(cafe.cafeId, 'sms_bills'),
    hasFeature(cafe.cafeId, 'waiter_quick_add'),
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
      role={cafe.role}
      timezone={cafe.timezone}
      areas={(areas ?? []) as { id: string; name: string }[]}
      initialTables={(data ?? []) as FloorTable[]}
      smsBillsEnabled={smsBillsEnabled}
      waiterQuickAddEnabled={waiterQuickAddEnabled}
      menu={{
        categories: (categories ?? []) as MenuCategory[],
        items: (items ?? []) as MenuItem[],
        variants: (variants ?? []) as MenuVariant[],
        addons: (addons ?? []) as MenuAddon[],
      }}
    />
  )
}
