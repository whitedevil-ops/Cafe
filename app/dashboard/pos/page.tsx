import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import PosClient from './pos-client'
import type { PosCategory } from '@/components/pos/category-tabs'
import type { PosItem } from '@/components/pos/product-card'
import type { PosTable } from '@/components/pos/cart-panel'

export const dynamic = 'force-dynamic'

export type PosVariant = { id: string; menu_item_id: string; name: string; price_delta: number }
export type PosAddon = { id: string; menu_item_id: string; name: string; price: number }

export default async function PosPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()
  const [{ data: cafeRow }, { data: categories }, { data: items }, { data: tables }] = await Promise.all([
    supabase.from('cafes').select('tax_percent, service_charge').eq('id', cafe.cafeId).single(),
    supabase.from('menu_categories').select('id, name, sort').eq('cafe_id', cafe.cafeId).order('sort'),
    supabase
      .from('menu_items')
      .select('id, name, price, image_url, is_veg, is_bestseller, category_id')
      .eq('cafe_id', cafe.cafeId)
      .eq('available', true)
      .eq('archived', false)
      .order('sort'),
    supabase.from('cafe_tables').select('id, label, status').eq('cafe_id', cafe.cafeId),
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

  const withOptions = new Set([...(variants ?? []).map((v) => v.menu_item_id), ...(addons ?? []).map((a) => a.menu_item_id)])

  const posItems: (PosItem & { category_id: string | null })[] = (items ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    price: i.price,
    image_url: i.image_url,
    is_veg: i.is_veg,
    is_bestseller: i.is_bestseller,
    hasOptions: withOptions.has(i.id),
    category_id: i.category_id,
  }))

  const posCategories: PosCategory[] = (categories ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    count: posItems.filter((i) => i.category_id === c.id).length,
  }))

  const posTables: PosTable[] = (tables ?? [])
    .map((t) => ({ id: t.id, label: t.label, occupied: t.status === 'occupied' }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))

  return (
    <PosClient
      cafeId={cafe.cafeId}
      taxPercent={Number(cafeRow?.tax_percent ?? 0)}
      serviceChargePercent={Number(cafeRow?.service_charge ?? 0)}
      categories={posCategories}
      items={posItems}
      variants={(variants ?? []) as PosVariant[]}
      addons={(addons ?? []) as PosAddon[]}
      tables={posTables}
    />
  )
}
