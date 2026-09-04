import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import { hasFeature, getCafePlanName } from '@/lib/entitlements'
import { UpgradeRequired } from '@/components/upgrade-required'
import InventoryClient, { type InventoryItem } from './inventory-client'

export const dynamic = 'force-dynamic'

export default async function InventoryPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()

  if (!(await hasFeature(cafe.cafeId, 'inventory'))) {
    return <UpgradeRequired feature="Inventory" plan={await getCafePlanName(cafe.cafeId)} />
  }

  const { data } = await supabase
    .from('inventory_items')
    .select('id, name, sku, unit, current_stock, min_stock, cost, supplier')
    .eq('cafe_id', cafe.cafeId)
    .order('name')

  return <InventoryClient cafeId={cafe.cafeId} initialItems={(data ?? []) as InventoryItem[]} />
}
