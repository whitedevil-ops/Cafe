import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import { hasFeature, getCafePlanName } from '@/lib/entitlements'
import { UpgradeRequired } from '@/components/upgrade-required'
import SpinWheelPanel from '../loyalty/spin-wheel-panel'
import type { SpinSegment, SpinWheel, SpinAnalytics } from '@/lib/spin-wheel'

export const dynamic = 'force-dynamic'

// Spin & Win has its own screen because it is its own sellable feature (see
// migration 0204). It used to sit at the bottom of the Loyalty page, which
// made a café that bought Spin without Loyalty have to reach it through a
// screen they had no entitlement to.
//
// The panel component itself deliberately stays in app/dashboard/loyalty/ —
// moving the file would be a large rename touching nothing that matters here,
// and it is imported by exactly one page either way.
export default async function SpinPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  if (!(await hasFeature(cafe.cafeId, 'spin'))) {
    return <UpgradeRequired feature="Spin & Win" plan={await getCafePlanName(cafe.cafeId)} />
  }

  const supabase = await createClient()
  const [{ data: menuItems }, { data: wheel }] = await Promise.all([
    supabase.from('menu_items').select('id, name, price, archived').eq('cafe_id', cafe.cafeId).eq('archived', false).order('sort'),
    supabase
      .from('spin_wheels')
      .select('id, cafe_id, title, subtitle, active, expiry_days, min_order_amount, enable_confetti, enable_sound')
      .eq('cafe_id', cafe.cafeId)
      .maybeSingle(),
  ])

  const { data: wheelSegments } = wheel
    ? await supabase
        .from('spin_segments')
        .select('id, label, kind, menu_item_id, variant_id, value, weight, color, max_claims, claims_used, expiry_days')
        .eq('wheel_id', wheel.id)
        .order('sort')
    : { data: [] }

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString()
  const { data: spinAnalytics } = wheel
    ? await supabase.rpc('spin_wheel_analytics', { p_cafe_id: cafe.cafeId, p_from: monthStart, p_to: now.toISOString() })
    : { data: null }

  const itemIds = (menuItems ?? []).map((i) => i.id)
  const { data: menuItemVariants } = itemIds.length
    ? await supabase.from('menu_item_variants').select('id, menu_item_id, name').in('menu_item_id', itemIds).order('sort')
    : { data: [] }

  return (
    <SpinWheelPanel
      cafeId={cafe.cafeId}
      canManage={cafe.role === 'owner' || cafe.role === 'manager'}
      items={(menuItems ?? []) as { id: string; name: string; price: number; archived: boolean }[]}
      itemVariants={menuItemVariants ?? []}
      initialWheel={(wheel ?? null) as SpinWheel | null}
      initialSegments={(wheelSegments ?? []) as SpinSegment[]}
      initialAnalytics={spinAnalytics as SpinAnalytics | null}
    />
  )
}
