import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { hasFeature } from '@/lib/entitlements'
import { createClient } from '@/utils/supabase/server'
import OverviewClient from './overview-client'
import { redactReport, type OverviewReport } from './redact-report'
import { businessDayStartISO, businessDaysAgoStartISO } from '@/lib/datetime'

export const dynamic = 'force-dynamic'

export default async function ReportsOverviewPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  // Distinct from 'advanced_reports' (GST register, Adjustments, Operations,
  // Profitability, Recommendations) — this gates the single-day-window
  // reports every plan gets by default: Sales, Day Close, Item sales,
  // Payments & aging, and this Overview page itself.
  if (!(await hasFeature(cafe.cafeId, 'core_reports'))) {
    redirect('/dashboard')
  }

  // Default range: last 7 days, inclusive of today, in the café's own timezone.
  const from = businessDaysAgoStartISO(6, cafe.timezone)
  const to = new Date().toISOString()

  const supabase = await createClient()
  const [{ data, error }, crmAllowed, inventoryAllowed, advancedReportsAllowed] = await Promise.all([
    supabase.rpc('business_overview_report', { p_cafe_id: cafe.cafeId, p_from: from, p_to: to }),
    hasFeature(cafe.cafeId, 'crm'),
    hasFeature(cafe.cafeId, 'inventory'),
    hasFeature(cafe.cafeId, 'advanced_reports'),
  ])

  return (
    <OverviewClient
      cafeId={cafe.cafeId}
      cafeName={cafe.name}
      role={cafe.role}
      timezone={cafe.timezone}
      initialFrom={from}
      initialTo={to}
      initialReport={error ? null : redactReport(data as OverviewReport, crmAllowed, inventoryAllowed)}
      todayStart={businessDayStartISO(cafe.timezone)}
      crmAllowed={crmAllowed}
      inventoryAllowed={inventoryAllowed}
      advancedReportsAllowed={advancedReportsAllowed}
    />
  )
}
