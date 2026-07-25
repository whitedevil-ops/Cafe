import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import { hasFeature } from '@/lib/entitlements'
import { UpgradeRequired } from '@/components/upgrade-required'
import CouponsClient, { type Coupon, type CouponStat } from './coupons-client'

export const dynamic = 'force-dynamic'

export default async function CouponsPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()

  if (!(await hasFeature(cafe.cafeId, 'coupons'))) {
    const { data: planRow } = await supabase.from('cafes').select('plan').eq('id', cafe.cafeId).maybeSingle()
    return <UpgradeRequired feature="Coupons" plan={planRow?.plan ?? 'current'} />
  }

  const [{ data: coupons }, { data: stats }, { data: categories }, { data: couponCats }] = await Promise.all([
    supabase
      .from('coupons')
      .select('id, code, name, kind, value, min_order, max_discount, starts_at, ends_at, usage_limit, per_customer, active, created_at')
      .eq('cafe_id', cafe.cafeId)
      .order('created_at', { ascending: false }),
    supabase.rpc('coupon_stats', { p_cafe_id: cafe.cafeId }),
    supabase.from('menu_categories').select('id, name').eq('cafe_id', cafe.cafeId).order('sort'),
    supabase.from('coupon_categories').select('coupon_id, category_id, menu_categories(name)'),
  ])

  const categoriesByCoupon: Record<string, { id: string; name: string }[]> = {}
  for (const row of (couponCats ?? []) as { coupon_id: string; category_id: string; menu_categories: { name: string } | { name: string }[] | null }[]) {
    const rel = row.menu_categories
    const catName = Array.isArray(rel) ? rel[0]?.name : rel?.name
    if (!catName) continue
    categoriesByCoupon[row.coupon_id] = [...(categoriesByCoupon[row.coupon_id] ?? []), { id: row.category_id, name: catName }]
  }

  return (
    <CouponsClient
      cafeId={cafe.cafeId}
      role={cafe.role}
      initialCoupons={(coupons ?? []) as Coupon[]}
      initialStats={(stats ?? []) as CouponStat[]}
      categories={(categories ?? []) as { id: string; name: string }[]}
      categoriesByCoupon={categoriesByCoupon}
    />
  )
}
