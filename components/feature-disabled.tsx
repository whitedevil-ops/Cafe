import Link from 'next/link'
import { Lock } from 'lucide-react'

// Same visual pattern as components/upgrade-required.tsx, deliberately NOT
// reused for it — that component's copy ("upgrades as soon as your plan
// includes it") is correct for plan-tier gating but actively misleading
// here: every key this component gates on is `true` on every plan by
// default (see supabase/migrations/0233_ungated_feature_keys.sql) — the
// only way one of these is off is an Ops admin having deliberately
// switched it off for this specific café, which no plan upgrade changes.
export function FeatureDisabled({ feature }: { feature: string }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-surface-subtle text-muted-foreground">
        <Lock size={20} />
      </div>
      <h1 className="mt-4 text-xl font-semibold tracking-tight text-foreground">{feature} isn&apos;t available right now</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
        This has been turned off for your café. Nothing you&apos;ve already entered is lost — contact support if you
        weren&apos;t expecting this.
      </p>
      <Link
        href="/dashboard"
        className="mt-6 inline-block rounded-[var(--radius)] border border-border-strong px-5 py-2.5 text-sm font-medium text-foreground hover:bg-surface-subtle"
      >
        Back to dashboard
      </Link>
    </div>
  )
}
