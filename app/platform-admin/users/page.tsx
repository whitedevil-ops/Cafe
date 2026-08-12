import type { Metadata } from 'next'
import { createClient } from '@/utils/supabase/server'
import { NotAuthorized } from '@/components/platform-admin/not-authorized'
import { Page, PageHeader } from '@/components/platform-admin/ui'
import UsersClient, { type UserRow } from './users-client'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Users' }

export default async function PlatformUsers() {
  const supabase = await createClient()
  const { data: context } = await supabase.rpc('platform_admin_context')
  const permissions = (context as { permissions: Record<string, boolean> } | null)?.permissions ?? {}
  if (!permissions['users.view']) return <NotAuthorized section="users" />

  // op_list_users rather than a direct select: last sign-in lives in
  // auth.users and the café/order counts are joins the client cannot do under
  // RLS. The RPC re-checks users.view itself — this check only decides whether
  // to render the page at all.
  const { data, error } = await supabase.rpc('op_list_users', { p_search: null, p_limit: 200 })

  // A deploy can land before its migration is run. Say which one is missing
  // rather than throwing a 500 that looks like the console is broken — same
  // posture as the overview page.
  if (error) {
    return (
      <Page>
        <PageHeader title="Users" />
        <p className="mt-6 rounded-[var(--radius)] border border-warning bg-warning-subtle px-4 py-3 text-sm text-warning">
          Could not load users: {error.message}
          <br />
          <span className="text-[13px]">
            If this is new, run <code className="font-mono">0128_user_activity_and_detail.sql</code> in
            the Supabase SQL editor, then reload.
          </span>
        </p>
      </Page>
    )
  }

  return <UsersClient initialUsers={(data ?? []) as UserRow[]} />
}
