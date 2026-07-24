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
  const [{ data: categories }, { data: items }] = await Promise.all([
    supabase.from('menu_categories').select('*').eq('cafe_id', cafe.cafeId).order('sort'),
    supabase.from('menu_items').select('*').eq('cafe_id', cafe.cafeId).order('sort'),
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
