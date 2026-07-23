'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Search, ShieldCheck } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { formatDate } from '@/lib/datetime'

export type CafeRow = {
  cafe_id: string
  name: string
  city: string | null
  phone: string | null
  plan: string
  verified: boolean
  status: string
  created_at: string
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

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-success-subtle text-success',
  suspended: 'bg-destructive-subtle text-destructive',
  disabled: 'bg-surface-subtle text-muted-foreground',
  archived: 'bg-surface-subtle text-muted-foreground',
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

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Cafés</h1>
      <p className="mt-1 text-sm text-muted-foreground">{cafes.length} café{cafes.length === 1 ? '' : 's'} matching.</p>

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

      {cafes.length === 0 ? (
        <div className="mt-8 rounded-xl border border-border bg-surface p-10 text-center">
          <p className="text-sm text-muted-foreground">{loading ? 'Searching…' : 'No cafés match.'}</p>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-subtle text-left text-[12.5px] text-muted-foreground">
                <th className="px-4 py-3 font-medium">Café</th>
                <th className="px-4 py-3 font-medium">Owner</th>
                <th className="px-4 py-3 font-medium">City</th>
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Staff</th>
                <th className="px-4 py-3 font-medium">Orders</th>
                <th className="px-4 py-3 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {cafes.map((c) => (
                <tr key={c.cafe_id} className="border-b border-border last:border-0 hover:bg-surface-subtle">
                  <td className="px-4 py-3">
                    <Link href={`/platform-admin/cafes/${c.cafe_id}`} className="flex items-center gap-1.5 font-medium text-foreground hover:text-primary">
                      {c.verified && <ShieldCheck size={13} className="shrink-0 text-primary" />}
                      {c.name}
                    </Link>
                    <p className="text-[11.5px] text-muted-foreground">{c.cafe_id.slice(0, 8)}…</p>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <p className="text-foreground">{c.owner_name ?? '—'}</p>
                    <p className="text-[12px]">{c.owner_email ?? ''}</p>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{c.city ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-[12px] font-medium capitalize text-foreground">{c.plan}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[12px] font-medium capitalize ${STATUS_BADGE[c.status] ?? 'bg-surface-subtle text-muted-foreground'}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{c.staff_count}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.orders_count}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatDate(c.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
