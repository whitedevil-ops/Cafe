import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { byTableLabel } from '@/lib/table-sort'
import { createClient } from '@/utils/supabase/server'
import PosClient from './pos-client'
import type { PosCategory } from '@/components/pos/category-tabs'
import type { PosItem } from '@/components/pos/product-card'
import type { PosTable, PosArea } from '@/components/pos/cart-panel'

export const dynamic = 'force-dynamic'

export type PosVariant = { id: string; menu_item_id: string; name: string; price_delta: number }
export type PosAddon = { id: string; menu_item_id: string; name: string; price: number }

export default async function PosPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()
  const [{ data: cafeRow }, { data: categories }, { data: items }, { data: tables }, { data: areas }] = await Promise.all([
    supabase.from('cafes').select('tax_percent, service_charge, dine_in, takeaway').eq('id', cafe.cafeId).single(),
    supabase.from('menu_categories').select('id, name, sort').eq('cafe_id', cafe.cafeId).order('sort'),
    supabase
      .from('menu_items')
      .select('id, name, price, image_url, is_veg, is_bestseller, category_id, available')
      .eq('cafe_id', cafe.cafeId)
      .eq('archived', false)
      .order('sort'),
    supabase
      .from('cafe_tables')
      .select('id, label, status, capacity, area_id')
      .eq('cafe_id', cafe.cafeId)
      .eq('archived', false),
    supabase.from('floor_areas').select('id, name, sort').eq('cafe_id', cafe.cafeId).eq('archived', false).order('sort'),
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
    available: i.available,
    category_id: i.category_id,
  }))

  const posCategories: PosCategory[] = (categories ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    count: posItems.filter((i) => i.category_id === c.id).length,
  }))

  // POS reuses the canonical cafe_tables/floor_areas — the SAME layout the owner
  // configures in Floor & Table Setup. No separate POS table source.
  const posTables: PosTable[] = (tables ?? [])
    .map((t) => ({
      id: t.id,
      label: t.label,
      occupied: t.status === 'occupied',
      capacity: t.capacity ?? null,
      area_id: t.area_id ?? null,
    }))
    .sort(byTableLabel)

  const posAreas: PosArea[] = (areas ?? []).map((a) => ({ id: a.id, name: a.name }))

  return (
    <PosClient
      cafeId={cafe.cafeId}
      role={cafe.role}
      timezone={cafe.timezone}
      taxPercent={Number(cafeRow?.tax_percent ?? 0)}
      serviceChargePercent={Number(cafeRow?.service_charge ?? 0)}
      dineIn={cafeRow?.dine_in ?? true}
      takeaway={cafeRow?.takeaway ?? true}
      categories={posCategories}
      items={posItems}
      variants={(variants ?? []) as PosVariant[]}
      addons={(addons ?? []) as PosAddon[]}
      tables={posTables}
      areas={posAreas}
    />
  )
}
