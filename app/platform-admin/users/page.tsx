import type { Metadata } from 'next'
import { createClient } from '@/utils/supabase/server'
import { formatDate } from '@/lib/datetime'
import { NotAuthorized } from '@/components/platform-admin/not-authorized'
import { EmptyPanel, Page, PageHeader, TableWrap, Td, Th, Thead, Tr } from '@/components/platform-admin/ui'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Users' }

type Row = { id: string; full_name: string | null; email: string | null; phone: string | null; created_at: string }

export default async function PlatformUsers() {
  const supabase = await createClient()
  const { data: context } = await supabase.rpc('platform_admin_context')
  const permissions = (context as { permissions: Record<string, boolean> } | null)?.permissions ?? {}
  if (!permissions['users.view']) return <NotAuthorized section="users" />

  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, email, phone, created_at')
    .order('created_at', { ascending: false })

  const users = (data ?? []) as Row[]

  return (
    <Page>
      <PageHeader
        title="Users"
        subtitle={`${users.length} platform ${users.length === 1 ? 'user' : 'users'}, newest first.`}
      />

      <div className="mt-6">
        {users.length === 0 ? (
          <EmptyPanel message="No users yet." />
        ) : (
          <TableWrap minWidth={560}>
            <Thead>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Phone</Th>
              <Th align="right">Joined</Th>
            </Thead>
            <tbody>
              {users.map((u) => (
                <Tr key={u.id}>
                  <Td>
                    <span className="font-medium">{u.full_name ?? '—'}</span>
                  </Td>
                  <Td muted>{u.email ?? '—'}</Td>
                  <Td muted numeric>
                    {u.phone ?? '—'}
                  </Td>
                  <Td align="right" muted numeric>
                    {formatDate(u.created_at)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </div>
    </Page>
  )
}
