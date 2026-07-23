import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import CustomersClient from './customers-client'

export const dynamic = 'force-dynamic'

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
  const { data } = await supabase
    .from('v_customer_stats')
    .select('*')
    .eq('cafe_id', cafe.cafeId)
    .order('total_spend', { ascending: false })

  const { segment } = await searchParams
  const initialSegment = (['new', 'regular', 'vip', 'at_risk'] as const).includes(segment as never) ? (segment as CustomerStat['segment']) : 'all'

  return <CustomersClient cafeId={cafe.cafeId} timezone={cafe.timezone} initialCustomers={(data ?? []) as CustomerStat[]} initialSegment={initialSegment} />
}
