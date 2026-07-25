import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import { hasFeature } from '@/lib/entitlements'
import { UpgradeRequired } from '@/components/upgrade-required'
import ProfitabilityClient from './profitability-client'

export const dynamic = 'force-dynamic'

export default async function ProfitabilityPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')
  // Sensitive: contribution/margin is owner/manager only (spec §6). The
  // profitability_report RPC re-checks this server-side regardless of the UI.
  if (cafe.role !== 'owner' && cafe.role !== 'manager') redirect('/dashboard/reports')

  if (!(await hasFeature(cafe.cafeId, 'advanced_reports'))) {
    const supabase = await createClient()
    const { data: planRow } = await supabase.from('cafes').select('plan').eq('id', cafe.cafeId).maybeSingle()
    return <UpgradeRequired feature="Profitability reporting" plan={planRow?.plan ?? 'current'} />
  }

  return <ProfitabilityClient cafeId={cafe.cafeId} cafeName={cafe.name} timezone={cafe.timezone} />
}
