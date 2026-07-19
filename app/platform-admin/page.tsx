import { createClient } from '@/utils/supabase/server'

export const dynamic = 'force-dynamic'

function startOfTodayISO() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

async function count(promise: PromiseLike<{ count: number | null }>) {
  const { count } = await promise
  return count ?? 0
}

export default async function PlatformOverview() {
  const supabase = await createClient()
  const today = startOfTodayISO()

  // RLS lets a platform admin read across tenants; a café owner would get zeros/denied.
  const [totalCafes, totalUsers, cafesToday] = await Promise.all([
    count(supabase.from('cafes').select('*', { count: 'exact', head: true })),
    count(supabase.from('profiles').select('*', { count: 'exact', head: true })),
    count(
      supabase.from('cafes').select('*', { count: 'exact', head: true }).gte('created_at', today),
    ),
  ])

  const metrics = [
    { label: 'Registered cafés', value: totalCafes },
    { label: 'Platform users', value: totalUsers },
    { label: 'Registered today', value: cafesToday },
  ]

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Platform overview</h1>
      <p className="mt-1 text-sm text-muted-foreground">Live counts across every café on counter.</p>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-xl border border-border bg-surface p-5">
            <p className="text-[13px] text-muted-foreground">{m.label}</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-foreground">{m.value}</p>
          </div>
        ))}
      </div>

      {/* Honest about what isn't wired yet — no fake revenue (§4). */}
      <div className="mt-8 rounded-xl border border-border bg-surface p-5">
        <p className="text-sm font-medium text-foreground">Revenue &amp; subscriptions</p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          MRR, ARR, and plan distribution appear here once subscription billing is connected. No
          figures are shown until then.
        </p>
      </div>
    </div>
  )
}
