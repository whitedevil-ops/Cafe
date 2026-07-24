import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import CouponsClient, { type Coupon, type CouponStat } from './coupons-client'

export const dynamic = 'force-dynamic'

export default async function CouponsPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()
  const [{ data: coupons }, { data: stats }] = await Promise.all([
    supabase
      .from('coupons')
      .select('id, code, name, kind, value, min_order, max_discount, starts_at, ends_at, usage_limit, per_customer, active, created_at')
      .eq('cafe_id', cafe.cafeId)
      .order('created_at', { ascending: false }),
    supabase.rpc('coupon_stats', { p_cafe_id: cafe.cafeId }),
  ])

  return (
    <CouponsClient
      cafeId={cafe.cafeId}
      role={cafe.role}
      initialCoupons={(coupons ?? []) as Coupon[]}
      initialStats={(stats ?? []) as CouponStat[]}
    />
  )
}
