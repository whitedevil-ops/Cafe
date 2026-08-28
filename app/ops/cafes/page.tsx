import type { Metadata } from 'next'
import { createClient } from '@/utils/supabase/server'
import { NotAuthorized } from '@/components/ops/not-authorized'
import CafesClient, { type CafeRow } from './cafes-client'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Cafés' }

const STATUSES = ['active', 'suspended', 'disabled', 'archived']

export default async function AllCafes({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const supabase = await createClient()
  const { data: context } = await supabase.rpc('platform_admin_context')
  const permissions = (context as { permissions: Record<string, boolean> } | null)?.permissions ?? {}
  if (!permissions['cafes.view']) return <NotAuthorized section="cafés" />

  // A status arriving via the URL (Overview's Attention Required list links
  // here) pre-filters the very first fetch, so the page lands already
  // scoped instead of flashing every café before the client-side re-fetch
  // catches up.
  const { status } = await searchParams
  const initialStatus = STATUSES.includes(status as string) ? (status as string) : ''

  const [{ data }, { data: plans }] = await Promise.all([
    supabase.rpc('op_list_cafes', { p_status: initialStatus || null }),
    supabase.from('platform_plans').select('key, name, price_monthly, price_yearly').eq('active', true).order('sort'),
  ])

  return (
    <CafesClient
      initialCafes={(data ?? []) as CafeRow[]}
      initialStatus={initialStatus}
      permissions={permissions}
      plans={plans ?? []}
    />
  )
}
