import type { Metadata } from 'next'
import { createClient } from '@/utils/supabase/server'
import { NotAuthorized } from '@/components/platform-admin/not-authorized'
import AdminsClient, { type AdminRow } from './admins-client'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Admins' }

export default async function AdminsPage() {
  const supabase = await createClient()
  const { data: context } = await supabase.rpc('platform_admin_context')
  const ctx = context as { admin_id: string; role: string; permissions: Record<string, boolean> } | null
  if (!ctx?.permissions['admins.view']) return <NotAuthorized section="admin management" />

  const { data } = await supabase.rpc('op_list_admins')

  return (
    <AdminsClient
      initialAdmins={(data ?? []) as AdminRow[]}
      permissions={ctx.permissions}
      selfAdminId={ctx.admin_id}
      selfRole={ctx.role}
    />
  )
}
