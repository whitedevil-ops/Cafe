import { notFound } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { NotAuthorized } from '@/components/ops/not-authorized'
import CafeDetailClient, { type CafeDetail } from './cafe-detail-client'

export const dynamic = 'force-dynamic'

export default async function CafeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: context } = await supabase.rpc('platform_admin_context')
  const permissions = (context as { permissions: Record<string, boolean> } | null)?.permissions ?? {}
  if (!permissions['cafes.view']) return <NotAuthorized section="café detail" />

  const { data, error } = await supabase.rpc('op_get_cafe_detail', { p_cafe_id: id })
  if (error || !data) notFound()

  const [{ data: plans }] = await Promise.all([
    supabase.from('platform_plans').select('key, name, price_monthly, price_yearly').eq('active', true).order('sort'),
  ])

  return <CafeDetailClient cafeId={id} detail={data as CafeDetail} plans={plans ?? []} permissions={permissions} />
}
