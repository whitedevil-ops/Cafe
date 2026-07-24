import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import SalesReportClient, { type SalesReport } from './sales-report-client'
import { businessDayStartISO, businessDaysAgoStartISO } from '@/lib/datetime'

export const dynamic = 'force-dynamic'

export default async function SalesReportPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  // Default range: last 7 days, inclusive of today, in the café's own timezone.
  const from = businessDaysAgoStartISO(6, cafe.timezone)
  const to = new Date().toISOString()

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('sales_report', {
    p_cafe_id: cafe.cafeId,
    p_from: from,
    p_to: to,
  })

  return (
    <SalesReportClient
      cafeId={cafe.cafeId}
      cafeName={cafe.name}
      role={cafe.role}
      timezone={cafe.timezone}
      initialFrom={from}
      initialTo={to}
      initialReport={(error ? null : (data as SalesReport)) ?? null}
      todayStart={businessDayStartISO(cafe.timezone)}
    />
  )
}
