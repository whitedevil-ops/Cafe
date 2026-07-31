import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import DayCloseClient, { type DayCloseReports } from './day-close-client'
import { businessDayStartISO } from '@/lib/datetime'

export const dynamic = 'force-dynamic'

// Everything this page shows already exists as separate reports — sales_report,
// gst_invoice_report, adjustments_report and payments_outstanding_report all
// take the same (p_cafe_id, p_from, p_to) shape, plus recent_shifts for cash
// variance. This is a pure composition over them for one business day; no new
// RPC, no migration.
export default async function DayClosePage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const from = businessDayStartISO(cafe.timezone)
  const to = new Date().toISOString() // "today so far" — mirrors every other report's "Today" preset

  const supabase = await createClient()
  const [sales, gst, adjustments, payments, shifts] = await Promise.all([
    supabase.rpc('sales_report', { p_cafe_id: cafe.cafeId, p_from: from, p_to: to }),
    supabase.rpc('gst_invoice_report', { p_cafe_id: cafe.cafeId, p_from: from, p_to: to }),
    supabase.rpc('adjustments_report', { p_cafe_id: cafe.cafeId, p_from: from, p_to: to }),
    supabase.rpc('payments_outstanding_report', { p_cafe_id: cafe.cafeId, p_from: from, p_to: to }),
    supabase.rpc('recent_shifts', { p_cafe_id: cafe.cafeId, p_limit: 20 }),
  ])

  const initialReports: DayCloseReports = {
    sales: sales.error ? null : sales.data,
    gst: gst.error ? null : gst.data,
    adjustments: adjustments.error ? null : adjustments.data,
    payments: payments.error ? null : payments.data,
    shifts: shifts.error ? null : shifts.data,
  }

  return (
    <DayCloseClient
      cafeId={cafe.cafeId}
      cafeName={cafe.name}
      role={cafe.role}
      timezone={cafe.timezone}
      initialFrom={from}
      initialTo={to}
      initialReports={initialReports}
    />
  )
}
