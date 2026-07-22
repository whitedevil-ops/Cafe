import Link from 'next/link'
import { createClient } from '@/utils/supabase/server'

export const dynamic = 'force-dynamic'

type HealthRow = {
  cafe_id: string
  name: string
  status: string
  days_since_last_order: number | null
  onboarding_percent: number
  failed_sms_count: number
  days_until_expiry: number | null
}

export default async function CafeHealth() {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('op_cafe_health')
  const rows = (data ?? []) as HealthRow[]

  const inactive = rows.filter((r) => r.status === 'active' && (r.days_since_last_order === null || r.days_since_last_order >= 7))
  const incompleteOnboarding = rows.filter((r) => r.onboarding_percent < 100)
  const failedSms = rows.filter((r) => r.failed_sms_count > 0)
  const expiringSoon = rows.filter((r) => r.days_until_expiry !== null && r.days_until_expiry <= 30 && r.days_until_expiry >= 0)

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Café health</h1>
      <p className="mt-1 text-sm text-muted-foreground">Proactive signals — cafés that likely need a nudge, not a raw data dump.</p>

      {error && (
        <p className="mt-4 rounded-[var(--radius)] bg-destructive-subtle px-4 py-3 text-sm text-destructive">Could not load: {error.message}</p>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <HealthCard title="No recent orders (7+ days)" rows={inactive.map((r) => ({ id: r.cafe_id, name: r.name, detail: r.days_since_last_order === null ? 'Never ordered' : `${r.days_since_last_order}d ago` }))} empty="Every active café has ordered recently." />
        <HealthCard title="Onboarding incomplete" rows={incompleteOnboarding.map((r) => ({ id: r.cafe_id, name: r.name, detail: `${r.onboarding_percent}% done` }))} empty="Every café has finished onboarding." />
        <HealthCard title="Failed SMS deliveries" rows={failedSms.map((r) => ({ id: r.cafe_id, name: r.name, detail: `${r.failed_sms_count} failed` }))} empty="No failed SMS deliveries." />
        <HealthCard title="Subscription expiring within 30 days" rows={expiringSoon.map((r) => ({ id: r.cafe_id, name: r.name, detail: `${r.days_until_expiry}d left` }))} empty="Nothing expiring soon." />
      </div>
    </div>
  )
}

function HealthCard({ title, rows, empty }: { title: string; rows: { id: string; name: string; detail: string }[]; empty: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {rows.length > 0 && <span className="rounded-full bg-warning-subtle px-2 py-0.5 text-[11px] font-medium text-warning">{rows.length}</span>}
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/platform-admin/cafes/${r.id}`} className="flex items-center justify-between text-[13.5px] hover:text-primary">
                <span className="text-foreground">{r.name}</span>
                <span className="text-[12px] text-muted-foreground">{r.detail}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
