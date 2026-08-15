import type { Metadata } from 'next'
import Link from 'next/link'
import { CalendarClock, MessageSquareWarning, MoonStar, Rocket, type LucideIcon } from 'lucide-react'
import { createClient } from '@/utils/supabase/server'
import { EmptyState, Page, PageHeader, Panel, type StripTone } from '@/components/ops/ui'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Café health' }

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

  const needsAttention = inactive.length + incompleteOnboarding.length + failedSms.length + expiringSoon.length

  return (
    <Page>
      <PageHeader
        title="Café health"
        subtitle={
          needsAttention === 0
            ? 'Nothing needs a nudge right now.'
            : `${needsAttention} signal${needsAttention === 1 ? '' : 's'} across ${rows.length} café${rows.length === 1 ? '' : 's'} — proactive prompts, not a raw data dump.`
        }
      />

      {error && (
        <p className="mt-6 rounded-[var(--radius)] border border-destructive bg-destructive-subtle px-4 py-3 text-sm text-destructive">
          Could not load: {error.message}
        </p>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <HealthCard
          title="No recent orders"
          hint="Active cafés with nothing billed in 7+ days"
          icon={MoonStar}
          tone="warning"
          rows={inactive.map((r) => ({
            id: r.cafe_id,
            name: r.name,
            detail: r.days_since_last_order === null ? 'Never ordered' : `${r.days_since_last_order}d ago`,
          }))}
          empty="Every active café has ordered recently."
        />
        <HealthCard
          title="Onboarding incomplete"
          hint="Set-up started but not finished"
          icon={Rocket}
          tone="info"
          rows={incompleteOnboarding.map((r) => ({ id: r.cafe_id, name: r.name, detail: `${r.onboarding_percent}%` }))}
          empty="Every café has finished onboarding."
        />
        <HealthCard
          title="Failed SMS deliveries"
          hint="Messages the provider could not deliver"
          icon={MessageSquareWarning}
          tone="destructive"
          rows={failedSms.map((r) => ({ id: r.cafe_id, name: r.name, detail: `${r.failed_sms_count} failed` }))}
          empty="No failed SMS deliveries."
        />
        <HealthCard
          title="Expiring within 30 days"
          hint="Subscriptions approaching renewal"
          icon={CalendarClock}
          tone="warning"
          rows={expiringSoon.map((r) => ({ id: r.cafe_id, name: r.name, detail: `${r.days_until_expiry}d left` }))}
          empty="Nothing expiring soon."
        />
      </div>
    </Page>
  )
}

function HealthCard({
  title,
  hint,
  icon: Icon,
  tone,
  rows,
  empty,
}: {
  title: string
  hint: string
  icon: LucideIcon
  tone: StripTone
  rows: { id: string; name: string; detail: string }[]
  empty: string
}) {
  return (
    <Panel
      title={title}
      count={rows.length}
      tone={tone}
      action={<Icon size={15} className="text-muted-foreground" />}
    >
      <p className="-mt-1 mb-2 text-[11.5px] text-muted-foreground">{hint}</p>
      {rows.length === 0 ? (
        <EmptyState message={empty} />
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={`/ops/cafes/${r.id}`}
                className="group flex items-center justify-between gap-3 py-2 text-[13px]"
              >
                <span className="min-w-0 truncate text-foreground group-hover:text-primary">{r.name}</span>
                <span className="shrink-0 tabular-nums text-[12px] text-muted-foreground">{r.detail}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
