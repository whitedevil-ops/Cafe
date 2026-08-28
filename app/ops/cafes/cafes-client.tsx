'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Search, ShieldCheck, X } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { ReasonDialog } from '@/components/operator/reason-dialog'
import { formatDate } from '@/lib/datetime'
import {
  ActionsMenu, Badge, EmptyPanel, MenuItem, MonoId, Page, PageHeader, TableWrap, Td, Th, Thead, Tr, type StripTone,
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
  subscription_ends_at: string | null
}

type Plan = { key: string; name: string; price_monthly: number; price_yearly: number | null }

const STATUS_TONE: Record<string, StripTone> = {
  active: 'success', suspended: 'destructive', disabled: 'neutral', archived: 'neutral',
}

const STATUS_ACTIONS: { to: string; label: string; destructive: boolean }[] = [
  { to: 'active', label: 'Activate', destructive: false },
  { to: 'suspended', label: 'Suspend', destructive: true },
  { to: 'disabled', label: 'Disable', destructive: true },
  { to: 'archived', label: 'Archive', destructive: true },
]

type SortKey = 'name' | 'owner_name' | 'city' | 'plan' | 'status' | 'staff_count' | 'orders_count' | 'last_order_at' | 'subscription_ends_at' | 'created_at'

const SORT_VALUE: Record<SortKey, (c: CafeRow) => string | number | null> = {
  name: (c) => c.name.toLowerCase(),
  owner_name: (c) => (c.owner_name ?? '').toLowerCase(),
  city: (c) => (c.city ?? '').toLowerCase(),
  plan: (c) => c.plan,
  status: (c) => c.status,
  staff_count: (c) => c.staff_count,
  orders_count: (c) => c.orders_count,
  last_order_at: (c) => (c.last_order_at ? new Date(c.last_order_at).getTime() : null),
  subscription_ends_at: (c) => (c.subscription_ends_at ? new Date(c.subscription_ends_at).getTime() : null),
  created_at: (c) => new Date(c.created_at).getTime(),
}

function daysSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

// Heuristic, not backed by real usage data yet -- tune thresholds once
// there's enough order volume across cafés to know what "quiet" looks like.
function healthTier(c: CafeRow): { label: string; tone: StripTone } {
  if (!c.last_order_at) {
    return daysSince(c.created_at) <= 3 ? { label: 'New', tone: 'neutral' } : { label: 'No orders', tone: 'warning' }
  }
  const d = daysSince(c.last_order_at)
  if (d <= 2) return { label: 'Active', tone: 'success' }
  if (d <= 10) return { label: 'Quiet', tone: 'warning' }
  return { label: 'Stale', tone: 'destructive' }
}

function expiryDaysLeft(endsAt: string): number {
  return Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86400000)
}

function ExpiryCell({ endsAt }: { endsAt: string | null }) {
  if (!endsAt) return <span className="text-muted-foreground">—</span>
  const days = expiryDaysLeft(endsAt)
  const cls = days < 0 ? 'text-destructive' : days <= 7 ? 'text-warning' : 'text-muted-foreground'
  return (
    <span className={cls}>
      {formatDate(endsAt)}
      {days < 0 && <span className="ml-1 text-[11px]">expired</span>}
      {days >= 0 && days <= 7 && <span className="ml-1 text-[11px]">({days}d)</span>}
    </span>
  )
}

export default function CafesClient({
  initialCafes,
  initialStatus = '',
  permissions,
  plans,
}: {
  initialCafes: CafeRow[]
  initialStatus?: string
  permissions: Record<string, boolean>
  plans: Plan[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const { toast } = useToast()
  const confirm = useConfirm()

  const [cafes, setCafes] = useState(initialCafes)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<string>(initialStatus)
  const [verified, setVerified] = useState<string>('')
  const [plan, setPlan] = useState<string>('')
  const [expiring, setExpiring] = useState<string>('')
  const [loading, setLoading] = useState(false)

  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [statusDialog, setStatusDialog] = useState<{ cafe: CafeRow; to: string; label: string; destructive: boolean } | null>(null)
  const [statusSubmitting, setStatusSubmitting] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [planDialogCafe, setPlanDialogCafe] = useState<CafeRow | null>(null)
  const [resettingId, setResettingId] = useState<string | null>(null)

  const run = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.rpc('op_list_cafes', {
      p_search: search || null,
      p_status: status || null,
      p_verified: verified === '' ? null : verified === 'true',
      p_plan: plan || null,
      p_expiring_within_days: expiring ? Number(expiring) : null,
    })
    setCafes((data ?? []) as CafeRow[])
    setLoading(false)
  }, [supabase, search, status, verified, plan, expiring])

  useEffect(() => {
    const t = setTimeout(run, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, status, verified, plan, expiring])

  function toggleSort(key: SortKey) {
    if (sortKey !== key) { setSortKey(key); setSortDir('asc'); return }
    if (sortDir === 'asc') { setSortDir('desc'); return }
    setSortKey(null)
  }

  const sortedFlat = useMemo(() => {
    if (!sortKey) return null
    const get = SORT_VALUE[sortKey]
    const dir = sortDir === 'asc' ? 1 : -1
    return [...cafes].sort((a, b) => {
      const va = get(a); const vb = get(b)
      if (va === null && vb === null) return 0
      if (va === null) return 1
      if (vb === null) return -1
      if (va < vb) return -1 * dir
      if (va > vb) return 1 * dir
      return 0
    })
  }, [cafes, sortKey, sortDir])

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

  async function verifyCafe(c: CafeRow) {
    const next = !c.verified
    const ok = await confirm({
      title: next ? 'Verify this café?' : 'Remove verification?',
      description: next ? 'A verified badge will show wherever appropriate in the app.' : 'The verified badge will be removed.',
      confirmLabel: next ? 'Verify' : 'Remove',
    })
    if (!ok) return
    const { error } = await supabase.rpc('op_verify_cafe', { p_cafe_id: c.cafe_id, p_verified: next })
    if (error) return toast(error.message, 'error')
    toast(next ? 'Café verified.' : 'Verification removed.')
    void run()
  }

  async function submitStatusChange(reason: string) {
    if (!statusDialog) return
    setStatusSubmitting(true); setStatusError(null)
    const { error } = await supabase.rpc('op_set_cafe_status', {
      p_cafe_id: statusDialog.cafe.cafe_id, p_status: statusDialog.to, p_reason: reason,
    })
    setStatusSubmitting(false)
    if (error) return setStatusError(error.message)
    toast(`${statusDialog.cafe.name} status changed to ${statusDialog.to}.`)
    setStatusDialog(null)
    void run()
  }

  async function resetPassword(c: CafeRow) {
    const ok = await confirm({
      title: 'Reset owner password?',
      description: `Sends a secure password-reset link to ${c.owner_email}. No password is ever shown or stored.`,
      confirmLabel: 'Send reset link',
    })
    if (!ok) return
    setResettingId(c.cafe_id)
    const res = await fetch('/api/ops/reset-owner-password', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cafe_id: c.cafe_id }),
    })
    setResettingId(null)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return toast(body.error ?? 'Could not send reset link.', 'error')
    toast(`Reset link sent to ${body.email}.`)
  }

  const filtersOn = Boolean(search || status || verified || plan || expiring)

  return (
    <Page>
      <PageHeader
        title="Cafés"
        subtitle={
          filtersOn
            ? `${cafes.length} café${cafes.length === 1 ? '' : 's'} matching${sortKey ? '.' : ', grouped by owner.'}`
            : `${cafes.length} café${cafes.length === 1 ? '' : 's'} on the platform${sortKey ? '.' : ', grouped by owner.'}`
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
        <select value={expiring} onChange={(e) => setExpiring(e.target.value)} className="h-10 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[13px] text-foreground">
          <option value="">Any expiry</option>
          <option value="7">Expiring in 7 days</option>
          <option value="15">Expiring in 15 days</option>
          <option value="30">Expiring in 30 days</option>
        </select>
        {sortKey && (
          <button onClick={() => setSortKey(null)} className="h-10 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[13px] font-medium text-foreground hover:bg-surface-subtle">
            Group by owner
          </button>
        )}
      </div>

      <div className={`mt-5 transition-opacity ${loading ? 'opacity-60' : ''}`}>
        {cafes.length === 0 ? (
          <EmptyPanel message={loading ? 'Searching…' : filtersOn ? 'No cafés match these filters.' : 'No cafés on the platform yet.'} />
        ) : (
          <TableWrap minWidth={1180}>
            <Thead>
              <Th onSort={() => toggleSort('name')} sortDir={sortKey === 'name' ? sortDir : null}>Café</Th>
              <Th onSort={() => toggleSort('owner_name')} sortDir={sortKey === 'owner_name' ? sortDir : null}>Owner</Th>
              <Th onSort={() => toggleSort('city')} sortDir={sortKey === 'city' ? sortDir : null}>City</Th>
              <Th onSort={() => toggleSort('plan')} sortDir={sortKey === 'plan' ? sortDir : null}>Plan</Th>
              <Th onSort={() => toggleSort('status')} sortDir={sortKey === 'status' ? sortDir : null}>Status</Th>
              <Th onSort={() => toggleSort('last_order_at')} sortDir={sortKey === 'last_order_at' ? sortDir : null}>Health</Th>
              <Th align="right" onSort={() => toggleSort('staff_count')} sortDir={sortKey === 'staff_count' ? sortDir : null}>Staff</Th>
              <Th align="right" onSort={() => toggleSort('orders_count')} sortDir={sortKey === 'orders_count' ? sortDir : null}>Orders</Th>
              <Th align="right" onSort={() => toggleSort('subscription_ends_at')} sortDir={sortKey === 'subscription_ends_at' ? sortDir : null}>Expiry</Th>
              <Th align="right" onSort={() => toggleSort('created_at')} sortDir={sortKey === 'created_at' ? sortDir : null}>Joined</Th>
              <Th>{null}</Th>
            </Thead>
            <tbody>
              {sortedFlat
                ? sortedFlat.map((c) => (
                    <CafeRowTr key={c.cafe_id} c={c} permissions={permissions} openMenuId={openMenuId} setOpenMenuId={setOpenMenuId}
                      onVerify={verifyCafe} onStatusAction={(cafe, a) => { setStatusError(null); setStatusDialog({ cafe, ...a }) }}
                      onChangePlan={setPlanDialogCafe} onResetPassword={resetPassword} resettingId={resettingId} />
                  ))
                : ownerGroups.map((g) => (
                    <OwnerGroupRows key={g.ownerId ?? g.cafes[0].cafe_id} group={g} permissions={permissions}
                      openMenuId={openMenuId} setOpenMenuId={setOpenMenuId} onVerify={verifyCafe}
                      onStatusAction={(cafe, a) => { setStatusError(null); setStatusDialog({ cafe, ...a }) }}
                      onChangePlan={setPlanDialogCafe} onResetPassword={resetPassword} resettingId={resettingId} />
                  ))}
            </tbody>
          </TableWrap>
        )}
      </div>

      {statusDialog && (
        <ReasonDialog
          title={`${statusDialog.label} ${statusDialog.cafe.name}?`}
          description="This takes effect immediately for staff and QR ordering."
          confirmLabel={statusDialog.label} destructive={statusDialog.destructive}
          submitting={statusSubmitting} error={statusError}
          onClose={() => setStatusDialog(null)} onConfirm={submitStatusChange}
        />
      )}

      {planDialogCafe && (
        <ChangePlanDialog
          cafe={planDialogCafe} plans={plans}
          onClose={() => setPlanDialogCafe(null)}
          onApplied={(newEndsAt) => {
            const cafeName = planDialogCafe.name
            setPlanDialogCafe(null)
            toast(`${cafeName} — active until ${formatDate(newEndsAt)}.`)
            void run()
          }}
        />
      )}
    </Page>
  )
}

type OwnerGroup = { ownerId: string | null; name: string | null; email: string | null; phone: string | null; cafes: CafeRow[] }

type RowActionsProps = {
  permissions: Record<string, boolean>
  openMenuId: string | null
  setOpenMenuId: (id: string | null) => void
  onVerify: (c: CafeRow) => void
  onStatusAction: (c: CafeRow, a: { to: string; label: string; destructive: boolean }) => void
  onChangePlan: (c: CafeRow) => void
  onResetPassword: (c: CafeRow) => void
  resettingId: string | null
}

function OwnerGroupRows({ group, ...actions }: { group: OwnerGroup } & RowActionsProps) {
  return (
    <>
      <tr className="border-y border-border bg-surface-subtle">
        <td colSpan={11} className="border-l-2 border-l-primary px-4 py-2">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-[12.5px] font-semibold text-foreground">{group.name ?? 'Unnamed owner'}</span>
            <span className="text-[11.5px] text-muted-foreground">{group.email ?? '—'}</span>
            {group.phone && <span className="text-[11.5px] tabular-nums text-muted-foreground">· {group.phone}</span>}
            {group.cafes.length > 1 && (
              <span className="rounded-full bg-primary-subtle px-2 py-0.5 text-[11px] font-medium text-primary">{group.cafes.length} cafés</span>
            )}
          </div>
        </td>
      </tr>
      {group.cafes.map((c) => <CafeRowTr key={c.cafe_id} c={c} {...actions} indent />)}
    </>
  )
}

function CafeRowTr({ c, indent, ...actions }: { c: CafeRow; indent?: boolean } & RowActionsProps) {
  const health = healthTier(c)
  return (
    <Tr>
      <td className={`px-4 py-3 text-foreground ${indent ? 'pl-7' : ''}`}>
        <Link href={`/ops/cafes/${c.cafe_id}`} className="flex items-center gap-1.5 font-medium hover:text-primary">
          {c.verified && <ShieldCheck size={13} className="shrink-0 text-success" aria-label="Verified" />}
          {c.name}
        </Link>
        <MonoId id={c.cafe_id} />
      </td>
      <td className="px-4 py-3">
        <p className="text-foreground">{c.owner_name ?? '—'}</p>
        {c.owner_phone && <p className="text-[11.5px] tabular-nums text-muted-foreground">{c.owner_phone}</p>}
      </td>
      <Td muted>{c.city ?? '—'}</Td>
      <Td><Badge>{c.plan}</Badge></Td>
      <Td><Badge tone={STATUS_TONE[c.status] ?? 'neutral'}>{c.status}</Badge></Td>
      <Td><Badge tone={health.tone}>{health.label}</Badge></Td>
      <Td align="right" muted numeric>{c.staff_count}</Td>
      <Td align="right" muted numeric>{c.orders_count.toLocaleString('en-IN')}</Td>
      <Td align="right" numeric><ExpiryCell endsAt={c.subscription_ends_at} /></Td>
      <Td align="right" muted numeric>{formatDate(c.created_at)}</Td>
      <td className="relative px-2 py-3 text-right">
        <CafeActionsMenu c={c} {...actions} />
      </td>
    </Tr>
  )
}

function CafeActionsMenu({ c, permissions, openMenuId, setOpenMenuId, onVerify, onStatusAction, onChangePlan, onResetPassword, resettingId }: { c: CafeRow } & RowActionsProps) {
  const isOpen = openMenuId === c.cafe_id
  const canAny = permissions['cafes.verify'] || permissions['cafes.suspend'] || permissions['plans.change'] || permissions['cafes.reset_password']
  if (!canAny) return null
  return (
    <ActionsMenu open={isOpen} onToggle={() => setOpenMenuId(isOpen ? null : c.cafe_id)} onClose={() => setOpenMenuId(null)}>
      {permissions['cafes.verify'] && (
        <MenuItem onClick={() => { setOpenMenuId(null); onVerify(c) }}>{c.verified ? 'Remove verification' : 'Verify café'}</MenuItem>
      )}
      {permissions['cafes.suspend'] && STATUS_ACTIONS.filter((a) => a.to !== c.status).map((a) => (
        <MenuItem key={a.to} destructive={a.destructive} onClick={() => { setOpenMenuId(null); onStatusAction(c, a) }}>{a.label}</MenuItem>
      ))}
      {permissions['plans.change'] && (
        <MenuItem onClick={() => { setOpenMenuId(null); onChangePlan(c) }}>Change plan…</MenuItem>
      )}
      {permissions['cafes.reset_password'] && (
        <MenuItem disabled={!c.owner_email || resettingId === c.cafe_id} onClick={() => { setOpenMenuId(null); onResetPassword(c) }}>
          {resettingId === c.cafe_id ? 'Sending…' : 'Reset owner password'}
        </MenuItem>
      )}
    </ActionsMenu>
  )
}

function ChangePlanDialog({ cafe, plans, onClose, onApplied }: { cafe: CafeRow; plans: Plan[]; onClose: () => void; onApplied: (newEndsAt: string) => void }) {
  const supabase = useMemo(() => createClient(), [])
  const [planKey, setPlanKey] = useState(cafe.plan)
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function apply() {
    setSubmitting(true); setError(null)
    const { data: newEndsAt, error: rpcError } = await supabase.rpc('op_change_plan', {
      p_cafe_id: cafe.cafe_id, p_plan_key: planKey, p_effective_date: new Date(effectiveDate).toISOString(),
    })
    setSubmitting(false)
    if (rpcError) return setError(rpcError.message)
    onApplied(newEndsAt as string)
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose}>
      <div className="w-full max-w-sm rounded-t-2xl bg-surface p-6 shadow-[var(--shadow-lg)] sm:rounded-[var(--radius-lg)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-foreground">Change plan — {cafe.name}</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">Subscription end date is computed automatically: 14 days for Trial, 365 for annual plans, 30 otherwise. Renews a café suspended for expiry.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center text-muted-foreground"><X size={16} /></button>
        </div>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-[12.5px] font-medium text-muted-foreground">Plan</span>
            <select value={planKey} onChange={(e) => setPlanKey(e.target.value)} className="mt-1 h-10 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[13.5px] text-foreground">
              {plans.map((p) => <option key={p.key} value={p.key}>{p.name} — {p.price_yearly ? `₹${p.price_yearly}/yr` : `₹${p.price_monthly}/mo`}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[12.5px] font-medium text-muted-foreground">Effective date</span>
            <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className="mt-1 h-10 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[13.5px] text-foreground" />
          </label>
          {error && <p className="rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[12.5px] text-destructive">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="min-h-11 flex-1 rounded-[var(--radius)] border border-border-strong text-[14px] font-medium text-foreground">Cancel</button>
            <button onClick={apply} disabled={submitting} className="min-h-11 flex-1 rounded-[var(--radius)] bg-primary text-[14px] font-medium text-primary-foreground disabled:opacity-40">{submitting ? 'Applying…' : 'Apply'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
