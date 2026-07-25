import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import { hasFeature } from '@/lib/entitlements'
import { UpgradeRequired } from '@/components/upgrade-required'
import LoyaltyClient, { type Reward } from './loyalty-client'

export const dynamic = 'force-dynamic'

export default async function LoyaltyPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()

  if (!(await hasFeature(cafe.cafeId, 'loyalty'))) {
    const { data: planRow } = await supabase.from('cafes').select('plan').eq('id', cafe.cafeId).maybeSingle()
    return <UpgradeRequired feature="Loyalty & rewards" plan={planRow?.plan ?? 'current'} />
  }

  const [{ data: settings }, { data: rewards }] = await Promise.all([
    supabase.from('cafes').select('loyalty_enabled, loyalty_points_per_100').eq('id', cafe.cafeId).single(),
    supabase.from('rewards').select('id, name, points_cost, active, created_at').eq('cafe_id', cafe.cafeId).order('points_cost', { ascending: true }),
  ])

  return (
    <LoyaltyClient
      cafeId={cafe.cafeId}
      role={cafe.role}
      initialEnabled={settings?.loyalty_enabled ?? false}
      initialPointsPer100={settings?.loyalty_points_per_100 ?? 10}
      initialRewards={(rewards ?? []) as Reward[]}
    />
  )
}
