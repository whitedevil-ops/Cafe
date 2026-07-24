import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import OperationsClient, { type OperationsReport } from './operations-client'
import { businessDaysAgoStartISO } from '@/lib/datetime'

export const dynamic = 'force-dynamic'

export default async function OperationsReportPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const from = businessDaysAgoStartISO(6, cafe.timezone)
  const to = new Date().toISOString()

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('operations_report', { p_cafe_id: cafe.cafeId, p_from: from, p_to: to })

  return (
    <OperationsClient
      cafeId={cafe.cafeId}
      cafeName={cafe.name}
      role={cafe.role}
      timezone={cafe.timezone}
      initialFrom={from}
      initialTo={to}
      initialReport={(error ? null : (data as OperationsReport)) ?? null}
    />
  )
}
