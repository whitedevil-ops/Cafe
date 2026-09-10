import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import { hasFeature } from '@/lib/entitlements'
import GstClient, { type GstReport } from './gst-client'
import { businessDaysAgoStartISO } from '@/lib/datetime'

export const dynamic = 'force-dynamic'

export default async function GstReportPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()

  const advancedReportsAllowed = await hasFeature(cafe.cafeId, 'advanced_reports')
  if (!advancedReportsAllowed) {
    redirect('/dashboard')
  }

  const from = businessDaysAgoStartISO(6, cafe.timezone)
  const to = new Date().toISOString()

  const { data, error } = await supabase.rpc('gst_invoice_report_premium', { p_cafe_id: cafe.cafeId, p_from: from, p_to: to })

  return (
    <GstClient
      cafeId={cafe.cafeId}
      cafeName={cafe.name}
      role={cafe.role}
      timezone={cafe.timezone}
      initialFrom={from}
      initialTo={to}
      initialReport={(error ? null : (data as GstReport)) ?? null}
      initialError={error?.message ?? null}
      advancedReportsAllowed={advancedReportsAllowed}
    />
  )
}
