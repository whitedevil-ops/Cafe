import { notFound } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import MenuClient, { type PublicItem } from './menu-client'

export const dynamic = 'force-dynamic'

export default async function TablePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = await createClient() // anon context — public read policies apply

  const { data: table } = await supabase
    .from('cafe_tables')
    .select('id, label, cafe_id')
    .eq('token', token)
    .maybeSingle()
  if (!table) notFound()

  const [{ data: cafe }, { data: categories }, { data: items }] = await Promise.all([
    supabase.from('cafes').select('name, upsell_threshold').eq('id', table.cafe_id).maybeSingle(),
    supabase.from('menu_categories').select('id, name, sort').eq('cafe_id', table.cafe_id).order('sort'),
    supabase
      .from('menu_items')
      .select('id, name, description, price, category_id, is_veg, is_bestseller, is_upsell, upsell_pitch')
      .eq('cafe_id', table.cafe_id)
      .eq('available', true)
      .eq('archived', false)
      .order('sort'),
  ])
  if (!cafe) notFound()

  return (
    <MenuClient
      token={token}
      cafeName={cafe.name}
      tableLabel={table.label}
      upsellThreshold={cafe.upsell_threshold ?? 150}
      categories={(categories ?? []) as { id: string; name: string }[]}
      items={(items ?? []) as PublicItem[]}
    />
  )
}
