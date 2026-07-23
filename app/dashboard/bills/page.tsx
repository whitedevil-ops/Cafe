import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import BillsClient, { type BillsPayload } from './bills-client'
import { businessDayStartISO } from '@/lib/datetime'

export const dynamic = 'force-dynamic'

export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; type?: string }>
}) {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const { range, type } = await searchParams
  const supabase = await createClient()

  const from = businessDayStartISO(cafe.timezone)
  // Small forward buffer so an order written moments ago isn't excluded by
  // clock skew between the app server and Postgres. `to` is exclusive.
  const now = new Date()
  const to = new Date(now.getTime() + 60_000).toISOString()

  const { data } = await supabase.rpc('list_bills', {
    p_cafe_id: cafe.cafeId,
    p_from: from,
    p_to: to,
    p_type: type === 'dine_in' || type === 'takeaway' ? type : 'all',
    p_search: null,
    p_limit: 100,
    p_offset: 0,
  })

  return (
    <BillsClient
      cafeId={cafe.cafeId}
      timezone={cafe.timezone}
      role={cafe.role}
      initial={(data as BillsPayload) ?? null}
      initialType={type === 'dine_in' || type === 'takeaway' ? type : 'all'}
      initialRange={range === 'yesterday' || range === '7d' || range === '30d' ? range : 'today'}
    />
  )
}
