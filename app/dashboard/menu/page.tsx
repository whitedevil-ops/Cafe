import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import MenuManager from './menu-manager'
import type { MenuCategory, MenuItemRow } from './types'
import type { Combo, ComboSlot } from '@/lib/combos'

export const dynamic = 'force-dynamic'

export default async function MenuPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()
  const [{ data: categories }, { data: items }, { data: combos }] = await Promise.all([
    supabase.from('menu_categories').select('*').eq('cafe_id', cafe.cafeId).order('sort'),
    supabase.from('menu_items').select('*').eq('cafe_id', cafe.cafeId).order('sort'),
    // `margin` is included here and nowhere else — the POS and QR menu select
    // combos without it so the owner's own figure never reaches a guest.
    supabase.from('combos').select('id, name, description, price, margin, image_url, active, sort').eq('cafe_id', cafe.cafeId).order('sort'),
  ])

  // Slots for every combo, and variants for every item, in one round each —
  // the combo editor needs a size picker the moment a fixed item with sizes is
  // chosen, and a café's whole variant set is small enough not to warrant a
  // lazy per-item fetch here.
  const itemIds = (items ?? []).map((i) => i.id)
  const comboIds = (combos ?? []).map((c) => c.id)
  const [{ data: comboSlots }, { data: variants }] = await Promise.all([
    comboIds.length
      ? supabase.from('combo_slots').select('*').in('combo_id', comboIds).order('sort')
      : Promise.resolve({ data: [] }),
    itemIds.length
      ? supabase.from('menu_item_variants').select('id, menu_item_id, name, price_delta').in('menu_item_id', itemIds).order('sort')
      : Promise.resolve({ data: [] }),
  ])

  return (
    <MenuManager
      cafeId={cafe.cafeId}
      cafeName={cafe.name}
      role={cafe.role}
      initialCategories={(categories ?? []) as MenuCategory[]}
      initialItems={(items ?? []) as MenuItemRow[]}
      initialCombos={(combos ?? []) as Combo[]}
      initialComboSlots={(comboSlots ?? []) as ComboSlot[]}
      variants={(variants ?? []) as { id: string; menu_item_id: string; name: string; price_delta: number }[]}
    />
  )
}
