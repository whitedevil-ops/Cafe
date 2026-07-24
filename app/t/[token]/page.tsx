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
    supabase.from('cafes').select('name, logo_url, upsell_threshold, accept_pay_counter, online_payments_enabled, razorpay_status').eq('id', table.cafe_id).maybeSingle(),
    supabase.from('menu_categories').select('id, name, sort').eq('cafe_id', table.cafe_id).order('sort'),
    // Unavailable items are fetched too and rendered subdued rather than
    // hidden — a customer looking for something needs to see it's sold out
    // today, not silently wonder whether the café stopped making it.
    // place_order still refuses `available = false` server-side, so showing
    // them here cannot be used to order one.
    supabase
      .from('menu_items')
      .select('id, name, description, price, image_url, category_id, is_veg, is_bestseller, is_upsell, upsell_pitch, available, created_at')
      .eq('cafe_id', table.cafe_id)
      .eq('archived', false)
      .order('sort'),
  ])
  if (cafeErr) console.error('[qr] cafes lookup failed:', cafeErr.message, 'cafe_id=', table.cafe_id)
  if (!cafe) notFound()

  const itemIds = (items ?? []).map((i) => i.id)
  const [{ data: variants }, { data: addons }, { data: popular }] = await Promise.all([
    itemIds.length
      ? supabase.from('menu_item_variants').select('id, menu_item_id, name, price_delta').in('menu_item_id', itemIds).order('sort')
      : Promise.resolve({ data: [] }),
    itemIds.length
      ? supabase.from('menu_item_addons').select('id, menu_item_id, name, price').in('menu_item_id', itemIds).order('sort')
      : Promise.resolve({ data: [] }),
    // "Popular" is real 30-day sales, not a flag someone forgot to update.
    supabase.rpc('public_popular_items', { p_cafe_id: table.cafe_id, p_limit: 12 }),
  ])

  // Only surface popular items that are still orderable today.
  const availableIds = new Set((items ?? []).filter((i) => i.available).map((i) => i.id))
  const popularIds = ((popular ?? []) as { menu_item_id: string }[])
    .map((p) => p.menu_item_id)
    .filter((id) => availableIds.has(id))

  return (
    <MenuClient
      token={token}
      cafeName={cafe.name}
      cafeLogo={cafe.logo_url}
      tableLabel={table.label}
      onlinePaymentsEnabled={(cafe.online_payments_enabled ?? false) && cafe.razorpay_status === 'connected'}
      acceptPayCounter={cafe.accept_pay_counter ?? true}
      upsellThreshold={cafe.upsell_threshold ?? 150}
      categories={(categories ?? []) as { id: string; name: string }[]}
      items={(items ?? []) as PublicItem[]}
      variants={(variants ?? []) as Variant[]}
      addons={(addons ?? []) as Addon[]}
      popularIds={popularIds}
    />
  )
}
