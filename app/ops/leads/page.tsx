import type { Metadata } from 'next'
import { createClient } from '@/utils/supabase/server'
import { NotAuthorized } from '@/components/ops/not-authorized'
import LeadsClient, { type LeadRow, type NotificationEmailRow, type SignupInviteRow } from './leads-client'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Leads' }

export default async function LeadsPage() {
  const supabase = await createClient()
  const { data: context } = await supabase.rpc('platform_admin_context')
  const permissions = (context as { permissions: Record<string, boolean> } | null)?.permissions ?? {}
  if (!permissions['leads.view']) return <NotAuthorized section="leads" />

  const [{ data: leads }, { data: notificationEmails }, { data: invites }] = await Promise.all([
    supabase.rpc('op_list_leads'),
    permissions['leads.manage'] ? supabase.rpc('op_list_lead_notification_emails') : Promise.resolve({ data: [] }),
    supabase.rpc('op_list_signup_invites'),
  ])

  return (
    <LeadsClient
      initialLeads={(leads ?? []) as LeadRow[]}
      initialNotificationEmails={(notificationEmails ?? []) as NotificationEmailRow[]}
      initialInvites={(invites ?? []) as SignupInviteRow[]}
      canManage={!!permissions['leads.manage']}
    />
  )
}
