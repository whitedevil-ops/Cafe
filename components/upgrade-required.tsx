import Link from 'next/link'
import { Lock } from 'lucide-react'

export function UpgradeRequired({ feature, plan }: { feature: string; plan: string }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-surface-subtle text-muted-foreground">
        <Lock size={20} />
      </div>
      <h1 className="mt-4 text-xl font-semibold tracking-tight text-foreground">{feature} isn&apos;t on your plan</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
        Your café is on the <span className="font-medium text-foreground">{plan}</span> plan. Nothing you&apos;ve
        already entered is lost — this section unlocks as soon as your plan includes it.
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
