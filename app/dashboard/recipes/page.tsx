import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import { hasFeature } from '@/lib/entitlements'
import { UpgradeRequired } from '@/components/upgrade-required'
import RecipesClient, { type CostRow, type RecipeRow, type InventoryOption } from './recipes-client'

export const dynamic = 'force-dynamic'

export default async function RecipesPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()

  // Recipes/costing are meaningless without inventory, so they share its
  // entitlement rather than introducing a second flag nobody configured.
  if (!(await hasFeature(cafe.cafeId, 'inventory'))) {
    const { data: planRow } = await supabase.from('cafes').select('plan').eq('id', cafe.cafeId).maybeSingle()
    return <UpgradeRequired feature="Recipes & food cost" plan={planRow?.plan ?? 'current'} />
  }

  const [{ data: costs }, { data: recipes }, { data: inventory }, { data: cafeRow }] = await Promise.all([
    supabase.rpc('menu_item_costs', { p_cafe_id: cafe.cafeId }),
    supabase
      .from('recipe_items')
      .select('id, menu_item_id, inventory_item_id, qty')
      .eq('cafe_id', cafe.cafeId),
    supabase
      .from('inventory_items')
      .select('id, name, unit, cost')
      .eq('cafe_id', cafe.cafeId)
      .order('name'),
    supabase.from('cafes').select('auto_deduct_stock').eq('id', cafe.cafeId).maybeSingle(),
  ])

  return (
    <RecipesClient
      cafeId={cafe.cafeId}
      canManage={cafe.role === 'owner' || cafe.role === 'manager'}
      initialCosts={(costs ?? []) as CostRow[]}
      initialRecipes={(recipes ?? []) as RecipeRow[]}
      inventory={(inventory ?? []) as InventoryOption[]}
      autoDeduct={cafeRow?.auto_deduct_stock ?? false}
    />
  )
}
