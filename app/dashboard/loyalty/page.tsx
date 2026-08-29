import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import { hasFeature } from '@/lib/entitlements'
import { UpgradeRequired } from '@/components/upgrade-required'
import LoyaltyClient, { type Reward } from './loyalty-client'
import SpinWheelPanel from './spin-wheel-panel'
import type { SpinSegment, SpinWheel } from '@/lib/spin-wheel'

export const dynamic = 'force-dynamic'

export default async function LoyaltyPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()

  if (!(await hasFeature(cafe.cafeId, 'loyalty'))) {
    const { data: planRow } = await supabase.from('cafes').select('plan').eq('id', cafe.cafeId).maybeSingle()
    return <UpgradeRequired feature="Loyalty & rewards" plan={planRow?.plan ?? 'current'} />
  }

  const [{ data: settings }, { data: rewards }, { data: menuItems }, { data: wheel }] =
    await Promise.all([
      supabase.from('cafes').select('loyalty_enabled, loyalty_points_per_100').eq('id', cafe.cafeId).single(),
      supabase.from('rewards').select('id, name, points_cost, active, created_at, menu_item_id, variant_id').eq('cafe_id', cafe.cafeId).order('points_cost', { ascending: true }),
      supabase.from('menu_items').select('id, name, price, archived').eq('cafe_id', cafe.cafeId).eq('archived', false).order('sort'),
      supabase.from('spin_wheels').select('id, cafe_id, title, active, expiry_days').eq('cafe_id', cafe.cafeId).maybeSingle(),
    ])

  const { data: wheelSegments } = wheel
    ? await supabase
        .from('spin_segments')
        .select('id, label, kind, menu_item_id, variant_id, value, weight')
        .eq('wheel_id', wheel.id)
        .order('sort')
    : { data: [] }

  const itemIds = (menuItems ?? []).map((i) => i.id)
  const { data: menuItemVariants } = itemIds.length
    ? await supabase.from('menu_item_variants').select('id, menu_item_id, name').in('menu_item_id', itemIds).order('sort')
    : { data: [] }

  return (
    <>
    <LoyaltyClient
      cafeId={cafe.cafeId}
      role={cafe.role}
      initialEnabled={settings?.loyalty_enabled ?? false}
      initialPointsPer100={settings?.loyalty_points_per_100 ?? 10}
      initialRewards={(rewards ?? []) as Reward[]}
      menuItems={menuItems ?? []}
      menuItemVariants={menuItemVariants ?? []}
    />
    <SpinWheelPanel
      cafeId={cafe.cafeId}
      canManage={cafe.role === 'owner' || cafe.role === 'manager'}
      items={(menuItems ?? []) as { id: string; name: string; price: number; archived: boolean }[]}
      initialWheel={(wheel ?? null) as SpinWheel | null}
      initialSegments={(wheelSegments ?? []) as SpinSegment[]}
    />
    </>
  )
}
