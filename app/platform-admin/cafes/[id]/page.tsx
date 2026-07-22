import { notFound } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import CafeDetailClient, { type CafeDetail } from './cafe-detail-client'

export const dynamic = 'force-dynamic'

export default async function CafeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('op_get_cafe_detail', { p_cafe_id: id })
  if (error || !data) notFound()

  const [{ data: plans }] = await Promise.all([
    supabase.from('platform_plans').select('key, name, price_monthly').eq('active', true).order('sort'),
  ])

  return <CafeDetailClient cafeId={id} detail={data as CafeDetail} plans={plans ?? []} />
}
