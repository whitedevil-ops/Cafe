import type { Metadata } from 'next'
import { createClient } from '@/utils/supabase/server'
import { NotAuthorized } from '@/components/ops/not-authorized'
import AnalyticsClient, { type PlatformAnalytics } from './analytics-client'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Analytics' }

const DEFAULT_RANGE_DAYS = 30

export default async function AnalyticsPage() {
  const supabase = await createClient()
  const { data: context } = await supabase.rpc('platform_admin_context')
  const permissions = (context as { permissions: Record<string, boolean> } | null)?.permissions ?? {}
  if (!permissions['subscriptions.view']) return <NotAuthorized section="analytics" />

  const to = new Date()
  const from = new Date(to.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000)
  const { data } = await supabase.rpc('op_platform_analytics', {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  })

  return <AnalyticsClient initialData={(data ?? null) as PlatformAnalytics | null} initialRangeKey={String(DEFAULT_RANGE_DAYS)} />
}
