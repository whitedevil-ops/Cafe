import { notFound } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import MenuClient, { type PublicItem, type Variant, type Addon } from './menu-client'

export const dynamic = 'force-dynamic'

export default async function TablePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = await createClient() // anon context — public read policies apply

  const { data: table, error: tableErr } = await supabase
    .from('cafe_tables')
    .select('id, label, cafe_id')
    .eq('token', token)
    .maybeSingle()
  if (tableErr) console.error('[qr] cafe_tables lookup failed:', tableErr.message, 'token=', token)
  if (!table) notFound()

  const [{ data: cafe, error: cafeErr }, { data: categories }, { data: items }] = await Promise.all([
    supabase.from('cafes').select('name, logo_url, upsell_threshold, upi_id, upi_name').eq('id', table.cafe_id).maybeSingle(),
    supabase.from('menu_categories').select('id, name, sort').eq('cafe_id', table.cafe_id).order('sort'),
    supabase
      .from('menu_items')
      .select('id, name, description, price, image_url, category_id, is_veg, is_bestseller, is_upsell, upsell_pitch')
      .eq('cafe_id', table.cafe_id)
      .eq('available', true)
      .eq('archived', false)
      .order('sort'),
  ])
  if (cafeErr) console.error('[qr] cafes lookup failed:', cafeErr.message, 'cafe_id=', table.cafe_id)
  if (!cafe) notFound()

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
    <MenuClient
      token={token}
      cafeName={cafe.name}
      cafeLogo={cafe.logo_url}
      tableLabel={table.label}
      upiId={cafe.upi_id}
      upiName={cafe.upi_name}
      upsellThreshold={cafe.upsell_threshold ?? 150}
      categories={(categories ?? []) as { id: string; name: string }[]}
      items={(items ?? []) as PublicItem[]}
      variants={(variants ?? []) as Variant[]}
      addons={(addons ?? []) as Addon[]}
    />
  )
}
