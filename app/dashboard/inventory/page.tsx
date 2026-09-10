import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import { hasFeature } from '@/lib/entitlements'
import InventoryClient, { type InventoryItem } from './inventory-client'

export const dynamic = 'force-dynamic'

export default async function InventoryPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()

  if (!(await hasFeature(cafe.cafeId, 'inventory'))) {
    redirect('/dashboard')
  }

  const { data } = await supabase
    .from('inventory_items')
    .select('id, name, sku, unit, current_stock, min_stock, cost, supplier')
    .eq('cafe_id', cafe.cafeId)
    .order('name')

  // FOUND LIVE (full-product audit, 2026-09-10): create_inventory_item is
  // owner/manager-only at the RPC level (0185_fix_create_inventory_item.sql)
  // but InventoryClient never received the role prop to gate its "Add item"
  // control — any role granted this screen saw a fully clickable button
  // that always failed. record_inventory_movement genuinely is open to any
  // member (0166_phase1_security_lockdown_part4.sql), so that control is
  // correctly left ungated.
  return <InventoryClient cafeId={cafe.cafeId} role={cafe.role} initialItems={(data ?? []) as InventoryItem[]} />
}
