import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import { hasFeature } from '@/lib/entitlements'
import { UpgradeRequired } from '@/components/upgrade-required'
import WalletClient, { type Tier, type WalletOverview } from './wallet-client'

export const dynamic = 'force-dynamic'

export default async function WalletPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()

  if (!(await hasFeature(cafe.cafeId, 'wallet'))) {
    const { data: planRow } = await supabase.from('cafes').select('plan').eq('id', cafe.cafeId).maybeSingle()
    return <UpgradeRequired feature="Customer wallet" plan={planRow?.plan ?? 'current'} />
  }

  const [{ data: tiers }, { data: overview }] = await Promise.all([
    supabase
      .from('wallet_topup_tiers')
      .select('id, pay_amount, credit_amount, active, sort')
      .eq('cafe_id', cafe.cafeId)
      .order('sort'),
    supabase.rpc('wallet_overview', { p_cafe_id: cafe.cafeId }),
  ])

  return (
    <WalletClient
      cafeId={cafe.cafeId}
      role={cafe.role}
      timezone={cafe.timezone}
      initialTiers={(tiers ?? []) as Tier[]}
      initialOverview={(overview ?? { total_outstanding: 0, cash_collected_total: 0, wallets: [] }) as WalletOverview}
    />
  )
}
