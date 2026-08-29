import { notFound } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { NotAuthorized } from '@/components/ops/not-authorized'
import CafeDetailClient, { type CafeDetail, type HealthRow, type StaffRow } from './cafe-detail-client'

export const dynamic = 'force-dynamic'

export default async function CafeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: context } = await supabase.rpc('platform_admin_context')
  const permissions = (context as { permissions: Record<string, boolean> } | null)?.permissions ?? {}
  if (!permissions['cafes.view']) return <NotAuthorized section="café detail" />

  const { data, error } = await supabase.rpc('op_get_cafe_detail', { p_cafe_id: id })
  if (error || !data) notFound()

  const [{ data: plans }, { data: staff }] = await Promise.all([
    supabase.from('platform_plans').select('key, name, price_monthly, price_yearly, max_staff').eq('active', true).order('sort'),
    permissions['cafes.view'] ? supabase.rpc('op_list_cafe_staff', { p_cafe_id: id }) : Promise.resolve({ data: [] }),
  ])

  // billing_admin has cafes.view but NOT health.view (0142) -- gate the RPC
  // call itself, not just the render, so a role without the permission never
  // even triggers the "not authorized" exception path.
  const { data: healthRows } = permissions['health.view']
    ? await supabase.rpc('op_cafe_health', { p_cafe_id: id })
    : { data: null }
  const health = (healthRows as HealthRow[] | null)?.[0] ?? null

  return (
    <CafeDetailClient
      cafeId={id}
      detail={data as CafeDetail}
      plans={plans ?? []}
      permissions={permissions}
      health={health}
      initialStaff={(staff ?? []) as StaffRow[]}
    />
  )
}
