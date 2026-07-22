import Link from 'next/link'
import { createClient } from '@/utils/supabase/server'

export const dynamic = 'force-dynamic'

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
      <div className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Platform overview</h1>
        <p className="mt-4 rounded-[var(--radius)] bg-destructive-subtle px-4 py-3 text-sm text-destructive">
          Could not load platform metrics{error ? `: ${error.message}` : ''}. Run migrations 0019/0020 if this is new.
        </p>
      </div>
    )
  }

  const topMetrics = [
    ['Total cafés', o.total_cafes],
    ['Active cafés', o.active_cafes],
    ['Active today', o.active_cafes_today],
    ['New this month', o.new_cafes_this_month],
  ] as const

  const cafeStateMetrics = [
    ['Verified', o.verified_cafes],
    ['Unverified', o.unverified_cafes],
    ['Trial', o.trial_cafes],
    ['Suspended', o.suspended_cafes],
  ] as const

  const platformMetrics = [
    ['Total platform orders', o.total_orders],
    ['Total customers', o.total_customers],
  ] as const

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Platform overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">Live counts across every café on KhaoPiyo.</p>
        </div>
        <Link href="/platform-admin/cafes" className="min-h-11 rounded-[var(--radius)] border border-border-strong bg-surface px-4 py-2.5 text-sm font-medium text-foreground hover:bg-surface-subtle flex items-center">
          Search cafés →
        </Link>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {topMetrics.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-border bg-surface p-5">
            <p className="text-[13px] text-muted-foreground">{label}</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-foreground">{value}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cafeStateMetrics.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-border bg-surface p-4">
            <p className="text-[12.5px] text-muted-foreground">{label}</p>
            <p className="mt-1 text-xl font-semibold text-foreground">{value}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {platformMetrics.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-border bg-surface p-4">
            <p className="text-[12.5px] text-muted-foreground">{label}</p>
            <p className="mt-1 text-xl font-semibold text-foreground">{value}</p>
          </div>
        ))}
      </div>

      {(o.expiring_7 > 0 || o.expiring_15 > 0) && (
        <div className="mt-6 rounded-[var(--radius)] border border-warning bg-warning-subtle px-4 py-3 text-[13.5px] text-warning">
          <span className="font-medium">{o.expiring_7}</span> subscription{o.expiring_7 === 1 ? '' : 's'} expiring in 7 days ·{' '}
          <span className="font-medium">{o.expiring_15}</span> in 15 days ·{' '}
          <span className="font-medium">{o.expiring_30}</span> in 30 days.{' '}
          <Link href="/platform-admin/health" className="font-medium underline">Review →</Link>
        </div>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="text-sm font-medium text-foreground">Plan breakdown</p>
          {o.plan_breakdown.length === 0 ? (
            <p className="mt-2 text-[13px] text-muted-foreground">No cafés yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {o.plan_breakdown.map((p) => (
                <li key={p.plan} className="flex items-center justify-between text-[13.5px]">
                  <span className="capitalize text-foreground">{p.plan}</span>
                  <span className="font-medium text-muted-foreground">{p.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="text-sm font-medium text-foreground">Recent registrations</p>
          {o.recent_registrations.length === 0 ? (
            <p className="mt-2 text-[13px] text-muted-foreground">No cafés yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {o.recent_registrations.map((c) => (
                <li key={c.id}>
                  <Link href={`/platform-admin/cafes/${c.id}`} className="flex items-center justify-between text-[13.5px] hover:text-primary">
                    <span className="text-foreground">{c.name}{c.city ? ` · ${c.city}` : ''}</span>
                    <span className="text-[12px] capitalize text-muted-foreground">{c.plan}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-border bg-surface p-5">
        <p className="text-sm font-medium text-foreground">Recent operator activity</p>
        {o.recent_activity.length === 0 ? (
          <p className="mt-2 text-[13px] text-muted-foreground">No administrative actions logged yet.</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {o.recent_activity.map((a, i) => (
              <li key={i} className="flex items-center justify-between text-[13px]">
                <span className="text-foreground">{a.action}</span>
                <span className="text-[12px] text-muted-foreground">{new Date(a.created_at).toLocaleString('en-IN')}</span>
              </li>
            ))}
          </ul>
        )}
        <Link href="/platform-admin/audit-logs" className="mt-3 inline-block text-[12.5px] text-primary hover:underline">View full audit log →</Link>
      </div>
    </div>
  )
}
