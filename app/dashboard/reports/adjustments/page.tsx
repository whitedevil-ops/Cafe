import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import { hasFeature, getCafePlanName } from '@/lib/entitlements'
import { UpgradeRequired } from '@/components/upgrade-required'
import AdjustmentsClient, { type AdjustmentsReport } from './adjustments-client'
import { businessDaysAgoStartISO } from '@/lib/datetime'

export const dynamic = 'force-dynamic'

export default async function AdjustmentsReportPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()

  if (!(await hasFeature(cafe.cafeId, 'advanced_reports'))) {
    return <UpgradeRequired feature="Adjustments reporting" plan={await getCafePlanName(cafe.cafeId)} />
  }

  const from = businessDaysAgoStartISO(6, cafe.timezone)
  const to = new Date().toISOString()

  const { data, error } = await supabase.rpc('adjustments_report_premium', { p_cafe_id: cafe.cafeId, p_from: from, p_to: to })

  return (
    <AdjustmentsClient
      cafeId={cafe.cafeId}
      cafeName={cafe.name}
      role={cafe.role}
      timezone={cafe.timezone}
      initialFrom={from}
      initialTo={to}
      initialReport={(error ? null : (data as AdjustmentsReport)) ?? null}
      initialError={error?.message ?? null}
    />
  )
}
