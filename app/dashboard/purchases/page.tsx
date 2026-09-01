import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import { hasFeature } from '@/lib/entitlements'
import { UpgradeRequired } from '@/components/upgrade-required'
import PurchasesClient, { type Supplier, type PurchaseOrder, type InventoryItemOption } from './purchases-client'

export const dynamic = 'force-dynamic'

// Unbounded before this: every purchase order the cafe has ever placed was
// fetched and rendered client-side in one go. Page it like bills does.
const PAGE_SIZE = 100

export default async function PurchasesPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()

  // Suppliers/purchase orders are meaningless without stock tracking — same
  // gate recipes.tsx already reuses rather than inventing a separate key.
  if (!(await hasFeature(cafe.cafeId, 'inventory'))) {
    const { data: planRow } = await supabase.from('cafes').select('plan').eq('id', cafe.cafeId).maybeSingle()
    return <UpgradeRequired feature="Purchases & Suppliers" plan={planRow?.plan ?? 'current'} />
  }

  const [{ data: suppliers }, { data: orders, count: ordersCount }, { data: items }] = await Promise.all([
    supabase.from('suppliers').select('id, name, contact_name, phone, email, address, notes, active, created_at')
      .eq('cafe_id', cafe.cafeId).order('name'),
    supabase
      .from('purchase_orders')
      .select('id, status, order_date, expected_date, notes, cancel_reason, created_at, suppliers(name), purchase_order_items(id, inventory_item_id, qty_ordered, qty_received, unit_cost, inventory_items(name, unit))', { count: 'exact' })
      .eq('cafe_id', cafe.cafeId)
      .order('created_at', { ascending: false })
      .range(0, PAGE_SIZE - 1),
    supabase.from('inventory_items').select('id, name, unit').eq('cafe_id', cafe.cafeId).order('name'),
  ])

  return (
    <PurchasesClient
      cafeId={cafe.cafeId}
      role={cafe.role}
      initialSuppliers={(suppliers ?? []) as Supplier[]}
      initialOrders={(orders ?? []) as unknown as PurchaseOrder[]}
      initialOrdersCount={ordersCount ?? (orders ?? []).length}
      inventoryItems={(items ?? []) as InventoryItemOption[]}
    />
  )
}
