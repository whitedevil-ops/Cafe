import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import { hasFeature, getCafePlanName } from '@/lib/entitlements'
import { UpgradeRequired } from '@/components/upgrade-required'
import CustomersClient from './customers-client'

export const dynamic = 'force-dynamic'

// Unbounded before this: every customer the cafe has ever had was fetched
// and rendered client-side in one go. Page it like bills/purchases do.
const PAGE_SIZE = 100

export type CustomerStat = {
  customer_id: string
  cafe_id: string
  name: string | null
  phone: string | null
  email: string | null
  visits: number
  total_spend: number
  avg_order_value: number
  last_visit: string | null
  favourite_item: string | null
  loyalty_points: number
  segment: 'new' | 'regular' | 'vip' | 'at_risk'
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ segment?: string }>
}) {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()

  if (!(await hasFeature(cafe.cafeId, 'crm'))) {
    return <UpgradeRequired feature="Customer Directory" plan={await getCafePlanName(cafe.cafeId)} />
  }

  const { data, count } = await supabase
    .from('v_customer_stats')
    .select('*', { count: 'exact' })
    .eq('cafe_id', cafe.cafeId)
    .order('total_spend', { ascending: false })
    .range(0, PAGE_SIZE - 1)

  const { segment } = await searchParams
  const initialSegment = (['new', 'regular', 'vip', 'at_risk'] as const).includes(segment as never) ? (segment as CustomerStat['segment']) : 'all'

  return (
    <CustomersClient
      cafeId={cafe.cafeId}
      timezone={cafe.timezone}
      initialCustomers={(data ?? []) as CustomerStat[]}
      totalCount={count ?? (data ?? []).length}
      initialSegment={initialSegment}
    />
  )
}
