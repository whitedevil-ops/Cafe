import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { createClient } from '@/utils/supabase/server'
import { formatDateTime } from '@/lib/datetime'
import { auditLabel, relativeTime } from '@/lib/audit-actions'
import {
  Badge,
  EmptyState,
  Page,
  PageHeader,
  Panel,
  PanelLink,
  ProportionRow,
  StatCard,
  StatStrip,
} from '@/components/ops/ui'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Overview' }

type Overview = {
  total_cafes: number
  active_cafes: number
  verified_cafes: number
  unverified_cafes: number
  trial_cafes: number
  suspended_cafes: number
  disabled_cafes: number
  archived_cafes: number
  total_orders: number
  total_customers: number
  new_cafes_this_month: number
  active_cafes_today: number
  expiring_7: number
  expiring_15: number
  expiring_30: number
  plan_breakdown: { plan: string; count: number }[]
  recent_registrations: { id: string; name: string; city: string | null; plan: string; created_at: string }[]
  recent_activity: { action: string; target_type: string | null; created_at: string }[]
}

export default async function PlatformOverview() {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('op_platform_overview')
  const o = data as Overview | null

  if (error || !o) {
    return (
      <Page>
        <PageHeader title="Platform overview" />
        <p className="mt-6 rounded-[var(--radius)] border border-destructive bg-destructive-subtle px-4 py-3 text-sm text-destructive">
          Could not load platform metrics{error ? `: ${error.message}` : ''}. Run migrations 0019/0020 if this is new.
        </p>
      </Page>
    )
  }

  const planTotal = o.plan_breakdown.reduce((s, p) => s + p.count, 0)

  return (
    <Page>
      <PageHeader
        title="Platform overview"
        subtitle="Live counts across every café on KhaoPiyo."
        actions={
          <Link
            href="/ops/cafes"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-[var(--radius)] border border-border-strong bg-surface px-4 text-[13px] font-medium text-foreground transition-colors hover:bg-surface-subtle"
          >
            Browse cafés
            <ArrowRight size={14} />
          </Link>
        }
      />

      {/* Four headline figures only. The previous version gave ten numbers the
          same visual weight across three stacked rows, so none of them read as
          the important one. */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total cafés" value={o.total_cafes} href="/ops/cafes" />
        <StatCard label="Active" value={o.active_cafes} hint="Not suspended or disabled" />
        <StatCard label="Ordered today" value={o.active_cafes_today} hint="Cafés that billed at least once" />
        <StatCard label="New this month" value={o.new_cafes_this_month} />
      </div>

      {/* Secondary counts describe states of the same population, so they read
          better as one segmented strip than as a second grid of cards. */}
      <div className="mt-4">
        <StatStrip
          items={[
            { label: 'Verified', value: o.verified_cafes, tone: 'success', href: '/ops/cafes' },
            { label: 'Unverified', value: o.unverified_cafes, tone: 'warning', href: '/ops/cafes' },
            { label: 'Trial', value: o.trial_cafes, tone: 'info', href: '/ops/cafes' },
            { label: 'Suspended', value: o.suspended_cafes, tone: 'destructive', href: '/ops/cafes' },
          ]}
        />
      </div>

      {(o.expiring_7 > 0 || o.expiring_15 > 0 || o.expiring_30 > 0) && (
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-[var(--radius)] border border-warning bg-warning-subtle px-4 py-3 text-[13px] text-warning">
          <span className="font-medium">Subscriptions expiring</span>
          <span className="tabular-nums">
            <strong className="font-semibold">{o.expiring_7}</strong> within 7 days
          </span>
          <span className="tabular-nums">
            <strong className="font-semibold">{o.expiring_15}</strong> within 15
          </span>
          <span className="tabular-nums">
            <strong className="font-semibold">{o.expiring_30}</strong> within 30
          </span>
          <Link href="/ops/health" className="ml-auto font-medium underline underline-offset-2">
            Review
          </Link>
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Panel title="Plans">
          {o.plan_breakdown.length === 0 ? (
            <EmptyState message="No cafés yet." />
          ) : (
            <ul>
              {o.plan_breakdown.map((p) => (
                <ProportionRow key={p.plan} label={p.plan} value={p.count} total={planTotal} />
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Recent registrations"
          action={<PanelLink href="/ops/cafes">All cafés</PanelLink>}
        >
          {o.recent_registrations.length === 0 ? (
            <EmptyState message="No cafés yet." />
          ) : (
            <ul className="divide-y divide-border">
              {o.recent_registrations.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/ops/cafes/${c.id}`}
                    className="group flex items-center justify-between gap-3 py-2 text-[13px]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-foreground group-hover:text-primary">
                        {c.name}
                      </span>
                      {c.city && <span className="block text-[11.5px] text-muted-foreground">{c.city}</span>}
                    </span>
                    <Badge>{c.plan}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Operator activity"
          action={<PanelLink href="/ops/audit-logs">Full log</PanelLink>}
        >
          {o.recent_activity.length === 0 ? (
            <EmptyState message="No administrative actions logged yet." />
          ) : (
            <ul className="divide-y divide-border">
              {o.recent_activity.map((a, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 py-2 text-[13px]">
                  {/* Machine names like `cafe.status_changed` used to be
                      rendered raw here. */}
                  <span className="min-w-0 truncate text-foreground">{auditLabel(a.action)}</span>
                  <span
                    className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground"
                    title={formatDateTime(a.created_at)}
                  >
                    {relativeTime(a.created_at) ?? formatDateTime(a.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <StatCard label="Orders, all time" value={o.total_orders} />
        <StatCard label="Customers, all time" value={o.total_customers} />
      </div>
    </Page>
  )
}
