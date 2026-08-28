import type { Metadata } from 'next'
import { createClient } from '@/utils/supabase/server'
import { NotAuthorized } from '@/components/ops/not-authorized'
import { Page, PageHeader } from '@/components/ops/ui'
import AlertsClient, { type AlertRow } from './alerts-client'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Alerts' }

const STATUSES = ['open', 'acknowledged', 'resolved']

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const supabase = await createClient()
  const { data: context } = await supabase.rpc('platform_admin_context')
  const permissions = (context as { permissions: Record<string, boolean> } | null)?.permissions ?? {}
  if (!permissions['alerts.view']) return <NotAuthorized section="alerts" />

  const { status } = await searchParams
  const initialStatus = STATUSES.includes(status as string) ? (status as string) : 'open'

  const { data, error } = await supabase.rpc('op_list_alerts', { p_status: initialStatus })

  if (error) {
    return (
      <Page>
        <PageHeader title="Alert centre" />
        <p className="mt-6 rounded-[var(--radius)] border border-warning bg-warning-subtle px-4 py-3 text-sm text-warning">
          Could not load alerts: {error.message}
          <br />
          <span className="text-[13px]">
            If this is new, run <code className="font-mono">0172_alert_centre.sql</code> in
            the Supabase SQL editor, then reload.
          </span>
        </p>
      </Page>
    )
  }

  const alerts = (data ?? []) as AlertRow[]

  // acknowledged_by/resolved_by come back as raw ids — resolved to names the
  // same way app/ops/audit-logs already does for actor_id.
  const actorIds = [...new Set(alerts.flatMap((a) => [a.acknowledged_by, a.resolved_by]).filter(Boolean))] as string[]
  const { data: actors } = actorIds.length
    ? await supabase.from('profiles').select('id, full_name').in('id', actorIds)
    : { data: [] as { id: string; full_name: string | null }[] }
  const actorName = Object.fromEntries((actors ?? []).map((a) => [a.id, a.full_name]))

  return (
    <AlertsClient
      initialAlerts={alerts}
      initialStatus={initialStatus}
      canManage={Boolean(permissions['alerts.manage'])}
      actorName={actorName}
    />
  )
}
