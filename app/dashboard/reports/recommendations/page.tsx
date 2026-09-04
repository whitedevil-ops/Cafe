import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import { hasFeature, getCafePlanName } from '@/lib/entitlements'
import { UpgradeRequired } from '@/components/upgrade-required'
import RecommendationsClient, { type RecommendationsReport } from './recommendations-client'
import { businessDaysAgoStartISO } from '@/lib/datetime'

export const dynamic = 'force-dynamic'

export default async function RecommendationsReportPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')
  if (cafe.role !== 'owner' && cafe.role !== 'manager') redirect('/dashboard/reports')

  const supabase = await createClient()

  if (!(await hasFeature(cafe.cafeId, 'advanced_reports'))) {
    return <UpgradeRequired feature="Recommendations reporting" plan={await getCafePlanName(cafe.cafeId)} />
  }

  const from = businessDaysAgoStartISO(29, cafe.timezone)
  const to = new Date().toISOString()

  const { data, error } = await supabase.rpc('recommendation_report', { p_cafe_id: cafe.cafeId, p_from: from, p_to: to })

  return (
    <RecommendationsClient
      cafeId={cafe.cafeId}
      cafeName={cafe.name}
      role={cafe.role}
      timezone={cafe.timezone}
      initialFrom={from}
      initialTo={to}
      initialReport={(error ? null : (data as RecommendationsReport)) ?? null}
      initialError={error?.message ?? null}
    />
  )
}
