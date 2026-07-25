import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import PurchasesClient, { type Supplier, type PurchaseOrder, type InventoryItemOption } from './purchases-client'

export const dynamic = 'force-dynamic'

export default async function PurchasesPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()
  const [{ data: suppliers }, { data: orders }, { data: items }] = await Promise.all([
    supabase.from('suppliers').select('id, name, contact_name, phone, email, address, notes, active, created_at')
      .eq('cafe_id', cafe.cafeId).order('name'),
    supabase
      .from('purchase_orders')
      .select('id, status, order_date, expected_date, notes, cancel_reason, created_at, suppliers(name), purchase_order_items(id, inventory_item_id, qty_ordered, qty_received, unit_cost, inventory_items(name, unit))')
      .eq('cafe_id', cafe.cafeId)
      .order('created_at', { ascending: false }),
    supabase.from('inventory_items').select('id, name, unit').eq('cafe_id', cafe.cafeId).order('name'),
  ])

  return (
    <PurchasesClient
      cafeId={cafe.cafeId}
      role={cafe.role}
      initialSuppliers={(suppliers ?? []) as Supplier[]}
      initialOrders={(orders ?? []) as unknown as PurchaseOrder[]}
      inventoryItems={(items ?? []) as InventoryItemOption[]}
    />
  )
}
