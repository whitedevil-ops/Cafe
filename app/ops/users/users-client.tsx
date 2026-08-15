'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { relativeTime } from '@/lib/audit-actions'
import {
  Badge,
  EmptyPanel,
  Page,
  PageHeader,
  TableWrap,
  Td,
  Th,
  Thead,
  Tr,
} from '@/components/ops/ui'

export type UserRow = {
  id: string
  full_name: string | null
  email: string | null
  phone: string | null
  created_at: string
  last_sign_in_at: string | null
  last_seen_at: string | null
  last_device: string | null
  cafe_count: number
  cafe_names: string | null
  orders_count: number
}

/**
 * "3h ago" for anything recent, an absolute date beyond a week, and an honest
 * "Never" rather than a dash — an operator needs to tell "hasn't been back in
 * months" apart from "we have no record".
 */
function when(iso: string | null, neverLabel = 'Never') {
  if (!iso) return <span className="text-muted-foreground/60">{neverLabel}</span>
  return (
    <span title={formatDateTime(iso)}>{relativeTime(iso) ?? formatDate(iso)}</span>
  )
}

export default function UsersClient({ initialUsers }: { initialUsers: UserRow[] }) {
  const supabase = useMemo(() => createClient(), [])
  const [users, setUsers] = useState(initialUsers)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)

  const run = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.rpc('op_list_users', { p_search: search || null, p_limit: 200 })
    setUsers((data ?? []) as UserRow[])
    setLoading(false)
  }, [supabase, search])

  useEffect(() => {
    const t = setTimeout(run, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  return (
    <Page width="full">
      <PageHeader
        title="Users"
        subtitle={`${users.length} café owner${users.length === 1 ? '' : 's'} and staff, most recently active first.`}
      />

      <div className="mt-5 max-w-md">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, phone, or user ID…"
            className="h-10 w-full rounded-[var(--radius)] border border-border-strong bg-surface pl-8 pr-3 text-[13.5px] text-foreground placeholder:text-muted-foreground"
          />
        </div>
      </div>

      <div className={`mt-5 transition-opacity ${loading ? 'opacity-60' : ''}`}>
        {users.length === 0 ? (
          <EmptyPanel message={loading ? 'Searching…' : search ? 'No users match.' : 'No users yet.'} />
        ) : (
          <TableWrap minWidth={1040}>
            <Thead>
              <Th>User</Th>
              <Th>Cafés</Th>
              <Th>Last active</Th>
              <Th>Device</Th>
              <Th>Last sign-in</Th>
              <Th align="right">Orders</Th>
              <Th align="right">Joined</Th>
            </Thead>
            <tbody>
              {users.map((u) => (
                <Tr key={u.id}>
                  <td className="px-4 py-3">
                    <Link
                      href={`/ops/users/${u.id}`}
                      className="font-medium text-foreground hover:text-primary"
                    >
                      {u.full_name?.trim() || 'Unnamed'}
                    </Link>
                    <p className="text-[11.5px] text-muted-foreground">{u.email ?? '—'}</p>
                  </td>
                  <Td muted>
                    {u.cafe_count === 0 ? (
                      <span className="text-muted-foreground/60">None</span>
                    ) : (
                      <span title={u.cafe_names ?? undefined}>
                        {u.cafe_count === 1 ? u.cafe_names : `${u.cafe_count} cafés`}
                      </span>
                    )}
                  </Td>
                  <Td muted numeric>
                    {when(u.last_seen_at, 'Not recorded')}
                  </Td>
                  <Td muted>
                    {u.last_device ? <Badge>{u.last_device}</Badge> : <span className="text-muted-foreground/60">—</span>}
                  </Td>
                  <Td muted numeric>
                    {when(u.last_sign_in_at)}
                  </Td>
                  <Td align="right" muted numeric>
                    {u.orders_count.toLocaleString('en-IN')}
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

      <p className="mt-3 text-[12px] text-muted-foreground">
        &ldquo;Last active&rdquo; has only been recorded since this feature shipped, so it reads
        &ldquo;Not recorded&rdquo; until a user next opens the dashboard. &ldquo;Last sign-in&rdquo;
        comes from the auth provider and is accurate historically.
      </p>
    </Page>
  )
}
