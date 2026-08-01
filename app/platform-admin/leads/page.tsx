import { createClient } from '@/utils/supabase/server'
import { NotAuthorized } from '@/components/platform-admin/not-authorized'
import LeadsClient, { type LeadRow, type NotificationEmailRow } from './leads-client'

export const dynamic = 'force-dynamic'

export default async function LeadsPage() {
  const supabase = await createClient()
  const { data: context } = await supabase.rpc('platform_admin_context')
  const permissions = (context as { permissions: Record<string, boolean> } | null)?.permissions ?? {}
  if (!permissions['leads.view']) return <NotAuthorized section="leads" />

  const [{ data: leads }, { data: notificationEmails }] = await Promise.all([
    supabase.rpc('op_list_leads'),
    permissions['leads.manage'] ? supabase.rpc('op_list_lead_notification_emails') : Promise.resolve({ data: [] }),
  ])

  return (
    <LeadsClient
      initialLeads={(leads ?? []) as LeadRow[]}
      initialNotificationEmails={(notificationEmails ?? []) as NotificationEmailRow[]}
      canManage={!!permissions['leads.manage']}
    />
  )
}
