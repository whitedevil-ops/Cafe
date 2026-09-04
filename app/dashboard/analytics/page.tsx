import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import { hasFeature, getCafePlanName } from '@/lib/entitlements'
import { UpgradeRequired } from '@/components/upgrade-required'
import { businessDaysAgoStartISO } from '@/lib/datetime'
import AnalyticsClient, { type AnalyticsReport } from './analytics-client'

export const dynamic = 'force-dynamic'

export default async function AnalyticsPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()

  if (!(await hasFeature(cafe.cafeId, 'advanced_analytics'))) {
    return <UpgradeRequired feature="Advanced Analytics" plan={await getCafePlanName(cafe.cafeId)} />
  }

  const from = businessDaysAgoStartISO(29, cafe.timezone)
  const to = new Date().toISOString()
  const { data } = await supabase.rpc('advanced_analytics_report', { p_cafe_id: cafe.cafeId, p_from: from, p_to: to })

  return (
    <AnalyticsClient
      cafeId={cafe.cafeId}
      timezone={cafe.timezone}
      initialFrom={from}
      initialTo={to}
      initialReport={(data as AnalyticsReport) ?? null}
    />
  )
}
