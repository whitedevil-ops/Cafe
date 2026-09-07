'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { relativeTime } from '@/lib/audit-actions'
import { groupByCafe, type UserMembershipRow } from '@/lib/group-users-by-cafe'
import {
  Badge,
  EmptyPanel,
  Page,
  PageHeader,
  Td,
  Th,
  Thead,
  Tr,
} from '@/components/ops/ui'

export type { UserMembershipRow }

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

export default function UsersClient({ initialRows }: { initialRows: UserMembershipRow[] }) {
  const supabase = useMemo(() => createClient(), [])
  const [rows, setRows] = useState(initialRows)
  const [search, setSearch] = useState('')
  const [hasCafe, setHasCafe] = useState<string>('')
  const [loading, setLoading] = useState(false)

  const run = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.rpc('op_list_users', {
      p_search: search || null,
      p_limit: 200,
      p_has_cafe: hasCafe === '' ? null : hasCafe === 'true',
    })
    setRows((data ?? []) as UserMembershipRow[])
    setLoading(false)
  }, [supabase, search, hasCafe])

  useEffect(() => {
    const t = setTimeout(run, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, hasCafe])

  const filtersOn = Boolean(search || hasCafe)
  const userCount = useMemo(() => new Set(rows.map((r) => r.id)).size, [rows])
  const groups = useMemo(() => groupByCafe(rows), [rows])

  return (
    <Page width="full">
      <PageHeader
        title="Users"
        subtitle={
          filtersOn
            ? `${userCount} user${userCount === 1 ? '' : 's'} matching, grouped by café.`
            : `${userCount} café owner${userCount === 1 ? '' : 's'} and staff, grouped by café — most active café first.`
        }
      />

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, phone, or user ID…"
            className="h-10 w-full rounded-[var(--radius)] border border-border-strong bg-surface pl-8 pr-3 text-[13.5px] text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <select
          value={hasCafe}
          onChange={(e) => setHasCafe(e.target.value)}
          className="h-10 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[13px] text-foreground"
        >
          <option value="">All users</option>
          <option value="true">Has café</option>
          <option value="false">No café</option>
        </select>
      </div>

      <div className={`mt-5 space-y-5 transition-opacity ${loading ? 'opacity-60' : ''}`}>
        {rows.length === 0 ? (
          <EmptyPanel message={loading ? 'Searching…' : filtersOn ? 'No users match these filters.' : 'No users yet.'} />
        ) : (
          groups.map((g) => (
            <div key={g.cafeId ?? '__none__'} className="rounded-[var(--radius)] border border-border bg-surface shadow-[var(--shadow-sm)]">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
                {g.cafeId ? (
                  <Link href={`/ops/cafes/${g.cafeId}`} className="text-[13.5px] font-semibold text-foreground hover:text-primary">
                    {g.cafeName}
                  </Link>
                ) : (
                  <span className="text-[13.5px] font-semibold text-muted-foreground">{g.cafeName}</span>
                )}
                <span className="text-[12px] text-muted-foreground">{g.users.length} user{g.users.length === 1 ? '' : 's'}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ minWidth: 880 }}>
                  <Thead>
                    <Th>User</Th>
                    <Th>Last active</Th>
                    <Th>Device</Th>
                    <Th>Last sign-in</Th>
                    <Th align="right">Orders</Th>
                    <Th align="right">Joined</Th>
                  </Thead>
                  <tbody>
                    {g.users.map((u) => (
                      <Tr key={u.id}>
                        <td className="px-4 py-3">
                          <Link href={`/ops/users/${u.id}`} className="font-medium text-foreground hover:text-primary">
                            {u.full_name?.trim() || 'Unnamed'}
                          </Link>
                          <p className="text-[11.5px] text-muted-foreground">
                            {u.email ?? '—'}
                            {u.phone && <span className="tabular-nums"> · {u.phone}</span>}
                          </p>
                        </td>
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
                </table>
              </div>
            </div>
          ))
        )}
      </div>

      <p className="mt-3 text-[12px] text-muted-foreground">
        &ldquo;Last active&rdquo; has only been recorded since this feature shipped, so it reads
        &ldquo;Not recorded&rdquo; until a user next opens the dashboard. &ldquo;Last sign-in&rdquo;
        comes from the auth provider and is accurate historically. A user on more than one café
        appears once under each.
      </p>
    </Page>
  )
}
