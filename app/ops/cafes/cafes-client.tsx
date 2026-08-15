'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Search, ShieldCheck } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { formatDate } from '@/lib/datetime'
import {
  Badge,
  EmptyPanel,
  MonoId,
  Page,
  PageHeader,
  TableWrap,
  Td,
  Th,
  Thead,
  Tr,
  type StripTone,
} from '@/components/ops/ui'

export type CafeRow = {
  cafe_id: string
  name: string
  city: string | null
  phone: string | null
  plan: string
  verified: boolean
  status: string
  created_at: string
  owner_id: string | null
  owner_name: string | null
  owner_email: string | null
  owner_phone: string | null
  staff_count: number
  orders_count: number
  last_order_at: string | null
  menu_items_count: number
  tables_count: number
  customers_count: number
}

const STATUS_TONE: Record<string, StripTone> = {
  active: 'success',
  suspended: 'destructive',
  disabled: 'neutral',
  archived: 'neutral',
}

export default function CafesClient({ initialCafes }: { initialCafes: CafeRow[] }) {
  const supabase = useMemo(() => createClient(), [])
  const [cafes, setCafes] = useState(initialCafes)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<string>('')
  const [verified, setVerified] = useState<string>('')
  const [plan, setPlan] = useState<string>('')
  const [loading, setLoading] = useState(false)

  const run = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.rpc('op_list_cafes', {
      p_search: search || null,
      p_status: status || null,
      p_verified: verified === '' ? null : verified === 'true',
      p_plan: plan || null,
    })
    setCafes((data ?? []) as CafeRow[])
    setLoading(false)
  }, [supabase, search, status, verified, plan])

  useEffect(() => {
    const t = setTimeout(run, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, status, verified, plan])

  // Group by owner_id (falling back to the café's own id when an owner
  // somehow has none, so those cafés each get their own group instead of
  // being merged together) — a single owner can run up to a plan's
  // max_owned_cafes locations, so the directory reads owner-first, café
  // second. Insertion order is preserved, and op_list_cafes already orders
  // by created_at desc, so each group naturally lands at the position of
  // its owner's most-recently-created café — no re-sort needed here.
  const ownerGroups = useMemo(() => {
    const groups = new Map<string, { ownerId: string | null; name: string | null; email: string | null; phone: string | null; cafes: CafeRow[] }>()
    for (const c of cafes) {
      const key = c.owner_id ?? `cafe:${c.cafe_id}`
      const existing = groups.get(key)
      if (existing) existing.cafes.push(c)
      else groups.set(key, { ownerId: c.owner_id, name: c.owner_name, email: c.owner_email, phone: c.owner_phone, cafes: [c] })
    }
    return [...groups.values()]
  }, [cafes])

  const filtersOn = Boolean(search || status || verified || plan)

  return (
    <Page>
      <PageHeader
        title="Cafés"
        subtitle={
          filtersOn
            ? `${cafes.length} café${cafes.length === 1 ? '' : 's'} matching, grouped by owner.`
            : `${cafes.length} café${cafes.length === 1 ? '' : 's'} on the platform, grouped by owner.`
        }
      />

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, owner, phone, email, or café ID…"
            className="h-10 w-full rounded-[var(--radius)] border border-border-strong bg-surface pl-8 pr-3 text-[13.5px] text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[13px] text-foreground">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="disabled">Disabled</option>
          <option value="archived">Archived</option>
        </select>
        <select value={verified} onChange={(e) => setVerified(e.target.value)} className="h-10 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[13px] text-foreground">
          <option value="">Verified + unverified</option>
          <option value="true">Verified only</option>
          <option value="false">Unverified only</option>
        </select>
        <select value={plan} onChange={(e) => setPlan(e.target.value)} className="h-10 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[13px] text-foreground">
          <option value="">All plans</option>
          <option value="trial">Trial</option>
          <option value="starter">Starter</option>
          <option value="pro">Pro</option>
          <option value="business">Business</option>
        </select>
      </div>

      <div className={`mt-5 transition-opacity ${loading ? 'opacity-60' : ''}`}>
        {cafes.length === 0 ? (
          <EmptyPanel
            message={
              loading
                ? 'Searching…'
                : filtersOn
                  ? 'No cafés match these filters.'
                  : 'No cafés on the platform yet.'
            }
          />
        ) : (
          <TableWrap minWidth={860}>
            <Thead>
              <Th>Café</Th>
              <Th>City</Th>
              <Th>Plan</Th>
              <Th>Status</Th>
              <Th align="right">Staff</Th>
              <Th align="right">Orders</Th>
              <Th align="right">Joined</Th>
            </Thead>
            <tbody>
              {ownerGroups.map((g) => (
                <OwnerGroupRows key={g.ownerId ?? g.cafes[0].cafe_id} group={g} />
              ))}
            </tbody>
          </TableWrap>
        )}
      </div>
    </Page>
  )
}

type OwnerGroup = { ownerId: string | null; name: string | null; email: string | null; phone: string | null; cafes: CafeRow[] }

function OwnerGroupRows({ group }: { group: OwnerGroup }) {
  return (
    <>
      {/* An owner band, not a data row — a left accent and a tighter height so
          it reads as a divider between groups rather than another café. */}
      <tr className="border-y border-border bg-surface-subtle">
        <td colSpan={7} className="border-l-2 border-l-primary px-4 py-2">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-[12.5px] font-semibold text-foreground">{group.name ?? 'Unnamed owner'}</span>
            <span className="text-[11.5px] text-muted-foreground">{group.email ?? '—'}</span>
            {group.phone && <span className="text-[11.5px] tabular-nums text-muted-foreground">· {group.phone}</span>}
            {group.cafes.length > 1 && (
              <span className="rounded-full bg-primary-subtle px-2 py-0.5 text-[11px] font-medium text-primary">
                {group.cafes.length} cafés
              </span>
            )}
          </div>
        </td>
      </tr>
      {group.cafes.map((c) => (
        <Tr key={c.cafe_id}>
          <td className="px-4 py-3 pl-7 text-foreground">
            <Link
              href={`/ops/cafes/${c.cafe_id}`}
              className="flex items-center gap-1.5 font-medium hover:text-primary"
            >
              {c.verified && <ShieldCheck size={13} className="shrink-0 text-success" aria-label="Verified" />}
              {c.name}
            </Link>
            <MonoId id={c.cafe_id} />
          </td>
          <Td muted>{c.city ?? '—'}</Td>
          <Td>
            <Badge>{c.plan}</Badge>
          </Td>
          <Td>
            <Badge tone={STATUS_TONE[c.status] ?? 'neutral'}>{c.status}</Badge>
          </Td>
          <Td align="right" muted numeric>
            {c.staff_count}
          </Td>
          <Td align="right" muted numeric>
            {c.orders_count.toLocaleString('en-IN')}
          </Td>
          <Td align="right" muted numeric>
            {formatDate(c.created_at)}
          </Td>
        </Tr>
      ))}
    </>
  )
}
