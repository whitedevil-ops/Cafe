import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/utils/supabase/server'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { relativeTime } from '@/lib/audit-actions'
import { NotAuthorized } from '@/components/platform-admin/not-authorized'
import {
  Badge,
  EmptyState,
  MonoId,
  Page,
  PageHeader,
  Panel,
  StatCard,
  TableWrap,
  Td,
  Th,
  Thead,
  Tr,
  type StripTone,
} from '@/components/platform-admin/ui'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'User' }

type Detail = {
  profile: { id: string; full_name: string | null; email: string | null; phone: string | null; created_at: string }
  auth: {
    last_sign_in_at: string | null
    email_confirmed_at: string | null
    account_created_at: string | null
    provider: string | null
  }
  activity: { last_seen_at: string | null; last_device: string | null }
  cafes: {
    id: string; name: string; city: string | null; role: string
    status: string; plan: string; joined_at: string
  }[]
  orders: { count: number; revenue: number; first_at: string | null; last_at: string | null }
  recent_orders: {
    id: string; short_code: string; total: number; status: string
    created_at: string; cafe_name: string
  }[]
}

const ORDER_TONE: Record<string, StripTone> = {
  completed: 'success',
  cancelled: 'destructive',
  ready: 'info',
  preparing: 'warning',
  placed: 'neutral',
}

const money = (n: number) => `₹${n.toLocaleString('en-IN')}`

/** Absolute date plus a relative hint — an operator needs both. */
function Stamp({ iso, never = 'Never' }: { iso: string | null; never?: string }) {
  if (!iso) return <span className="text-muted-foreground/60">{never}</span>
  const rel = relativeTime(iso)
  return (
    <span title={formatDateTime(iso)}>
      {formatDateTime(iso)}
      {rel && <span className="ml-1.5 text-[11.5px] text-muted-foreground">({rel})</span>}
    </span>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-border py-2.5 last:border-0">
      <span className="text-[12.5px] text-muted-foreground">{label}</span>
      <span className="text-[13px] text-foreground">{children}</span>
    </div>
  )
}

export default async function UserDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: context } = await supabase.rpc('platform_admin_context')
  const permissions = (context as { permissions: Record<string, boolean> } | null)?.permissions ?? {}
  if (!permissions['users.view']) return <NotAuthorized section="users" />

  const { data } = await supabase.rpc('op_user_detail', { p_user_id: id })
  const d = data as Detail | null
  if (!d) notFound()

  const name = d.profile.full_name?.trim() || 'Unnamed user'

  return (
    <Page>
      <Link
        href="/platform-admin/users"
        className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={13} />
        All users
      </Link>

      <PageHeader
        title={name}
        subtitle={[d.profile.email, d.profile.phone].filter(Boolean).join(' · ') || 'No contact details on file'}
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Orders rung up" value={d.orders.count} />
        <StatCard label="Revenue billed" value={money(d.orders.revenue)} hint="Excludes cancelled orders" />
        <StatCard label="Cafés" value={d.cafes.length} />
        <StatCard
          label="Last active"
          value={d.activity.last_seen_at ? (relativeTime(d.activity.last_seen_at) ?? formatDate(d.activity.last_seen_at)) : '—'}
          hint={d.activity.last_device ?? 'Device not recorded yet'}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Panel title="Account">
          <Field label="User ID">
            <MonoId id={d.profile.id} />
          </Field>
          <Field label="Email">{d.profile.email ?? '—'}</Field>
          <Field label="Email confirmed">
            {d.auth.email_confirmed_at ? (
              <Badge tone="success">Confirmed</Badge>
            ) : (
              <Badge tone="warning">Not confirmed</Badge>
            )}
          </Field>
          <Field label="Phone">{d.profile.phone ?? '—'}</Field>
          <Field label="Sign-in method">{d.auth.provider ?? 'password'}</Field>
          <Field label="Account created">
            <Stamp iso={d.auth.account_created_at ?? d.profile.created_at} />
          </Field>
        </Panel>

        <Panel title="Activity">
          <Field label="Last signed in">
            <Stamp iso={d.auth.last_sign_in_at} />
          </Field>
          <Field label="Last active">
            {/* Distinct from "Never": this only started being recorded when
                migration 0128 shipped, so an established user can legitimately
                show nothing here until their next visit. */}
            <Stamp iso={d.activity.last_seen_at} never="Not recorded yet" />
          </Field>
          <Field label="Last device">
            {d.activity.last_device ? (
              <Badge>{d.activity.last_device}</Badge>
            ) : (
              <span className="text-muted-foreground/60">Not recorded yet</span>
            )}
          </Field>
          <Field label="First order">
            <Stamp iso={d.orders.first_at} never="No orders" />
          </Field>
          <Field label="Most recent order">
            <Stamp iso={d.orders.last_at} never="No orders" />
          </Field>
        </Panel>
      </div>

      <div className="mt-4">
        <Panel title="Cafés" count={d.cafes.length} tone="info">
          {d.cafes.length === 0 ? (
            <EmptyState message="This user does not belong to any café." />
          ) : (
            <ul className="divide-y divide-border">
              {d.cafes.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/platform-admin/cafes/${c.id}`}
                    className="group flex flex-wrap items-center justify-between gap-3 py-2.5"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-medium text-foreground group-hover:text-primary">
                        {c.name}
                        {c.city && <span className="font-normal text-muted-foreground"> · {c.city}</span>}
                      </span>
                      <span className="text-[11.5px] text-muted-foreground">
                        Joined {formatDate(c.joined_at)}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <Badge tone={c.role === 'owner' ? 'info' : 'neutral'}>{c.role}</Badge>
                      <Badge tone={c.status === 'active' ? 'success' : 'warning'}>{c.status}</Badge>
                      <Badge>{c.plan}</Badge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-4">
        <Panel title="Recent orders">
          {d.recent_orders.length === 0 ? (
            <EmptyState message="This user has not rung up any orders." />
          ) : (
            <div className="-mx-5 -mb-4">
              <TableWrap minWidth={560}>
                <Thead>
                  <Th>Order</Th>
                  <Th>Café</Th>
                  <Th>Status</Th>
                  <Th align="right">Total</Th>
                  <Th align="right">Placed</Th>
                </Thead>
                <tbody>
                  {d.recent_orders.map((o) => (
                    <Tr key={o.id}>
                      <Td>
                        <span className="font-mono text-[12px]">{o.short_code}</span>
                      </Td>
                      <Td muted>{o.cafe_name}</Td>
                      <Td>
                        <Badge tone={ORDER_TONE[o.status] ?? 'neutral'}>{o.status}</Badge>
                      </Td>
                      <Td align="right" numeric>
                        {money(o.total)}
                      </Td>
                      <Td align="right" muted numeric>
                        <span title={formatDateTime(o.created_at)}>
                          {relativeTime(o.created_at) ?? formatDate(o.created_at)}
                        </span>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>
          )}
          {d.orders.count > d.recent_orders.length && (
            <p className="mt-3 text-[12px] text-muted-foreground">
              Showing the {d.recent_orders.length} most recent of{' '}
              {d.orders.count.toLocaleString('en-IN')} orders.
            </p>
          )}
        </Panel>
      </div>
    </Page>
  )
}
