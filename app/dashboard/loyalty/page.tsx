import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import { hasFeature } from '@/lib/entitlements'
import { UpgradeRequired } from '@/components/upgrade-required'
import LoyaltyClient, { type Reward, type Referral } from './loyalty-client'

export const dynamic = 'force-dynamic'

export default async function LoyaltyPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()

  if (!(await hasFeature(cafe.cafeId, 'loyalty'))) {
    const { data: planRow } = await supabase.from('cafes').select('plan').eq('id', cafe.cafeId).maybeSingle()
    return <UpgradeRequired feature="Loyalty & rewards" plan={planRow?.plan ?? 'current'} />
  }

  const referralAllowed = await hasFeature(cafe.cafeId, 'referral')

  const [{ data: settings }, { data: rewards }, { data: referrals }, { data: menuItems }] = await Promise.all([
    supabase.from('cafes').select('loyalty_enabled, loyalty_points_per_100, referral_enabled, referral_reward_amount, plan').eq('id', cafe.cafeId).single(),
    supabase.from('rewards').select('id, name, points_cost, active, created_at, menu_item_id, variant_id').eq('cafe_id', cafe.cafeId).order('points_cost', { ascending: true }),
    referralAllowed ? supabase.rpc('list_referrals', { p_cafe_id: cafe.cafeId }) : Promise.resolve({ data: [] }),
    supabase.from('menu_items').select('id, name').eq('cafe_id', cafe.cafeId).eq('archived', false).order('sort'),
  ])

  const itemIds = (menuItems ?? []).map((i) => i.id)
  const { data: menuItemVariants } = itemIds.length
    ? await supabase.from('menu_item_variants').select('id, menu_item_id, name').in('menu_item_id', itemIds).order('sort')
    : { data: [] }

  return (
    <LoyaltyClient
      cafeId={cafe.cafeId}
      role={cafe.role}
      initialEnabled={settings?.loyalty_enabled ?? false}
      initialPointsPer100={settings?.loyalty_points_per_100 ?? 10}
      initialRewards={(rewards ?? []) as Reward[]}
      menuItems={menuItems ?? []}
      menuItemVariants={menuItemVariants ?? []}
      referralAllowed={referralAllowed}
      referralPlan={settings?.plan ?? 'current'}
      initialReferralEnabled={settings?.referral_enabled ?? false}
      initialReferralReward={settings?.referral_reward_amount ?? 50}
      initialReferrals={(referrals ?? []) as Referral[]}
    />
  )
}
