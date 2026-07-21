import { createClient } from '@/utils/supabase/server'

export const dynamic = 'force-dynamic'

type Row = {
  id: string
  name: string
  slug: string
  city: string | null
  plan: string
  is_demo: boolean
  created_at: string
  owner: { full_name: string | null; email: string | null } | null
}

export default async function AllCafes() {
  const supabase = await createClient()
  let rows: unknown[] = []
  const { data } = await supabase
    .from('cafes')
    .select('id, name, slug, city, plan, is_demo, created_at, owner:profiles!cafes_owner_id_fkey(full_name, email)')
    .order('created_at', { ascending: false })

  if (data) {
    rows = data
  } else {
    // Deploys land before hand-run migrations: if 0005 (is_demo) isn't applied yet,
    // fall back to the pre-0005 shape instead of breaking the page.
    const fallback = await supabase
      .from('cafes')
      .select('id, name, slug, city, plan, created_at, owner:profiles!cafes_owner_id_fkey(full_name, email)')
      .order('created_at', { ascending: false })
    rows = (fallback.data ?? []).map((c) => ({ ...c, is_demo: false }))
  }

  const cafes = rows as Row[]

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Cafés</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {cafes.length} registered {cafes.length === 1 ? 'café' : 'cafés'}.
      </p>

      {cafes.length === 0 ? (
        <div className="mt-8 rounded-xl border border-border bg-surface p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No cafés registered yet. They appear here as owners sign up.
          </p>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-subtle text-left text-[13px] text-muted-foreground">
                <th className="px-4 py-3 font-medium">Café</th>
                <th className="px-4 py-3 font-medium">Owner</th>
                <th className="px-4 py-3 font-medium">City</th>
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 font-medium">Registered</th>
              </tr>
            </thead>
            <tbody>
              {cafes.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0 hover:bg-surface-subtle">
                  <td className="px-4 py-3">
                    <p className="flex items-center gap-2 font-medium text-foreground">
                      {c.name}
                      {c.is_demo && (
                        <span className="rounded-full bg-warning-subtle px-2 py-0.5 text-[11px] font-medium text-warning">
                          Demo
                        </span>
                      )}
                    </p>
                    <p className="text-[12px] text-muted-foreground">/{c.slug}</p>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <p className="text-foreground">{c.owner?.full_name ?? '—'}</p>
                    <p className="text-[12px]">{c.owner?.email ?? ''}</p>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{c.city ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-[12px] font-medium capitalize text-foreground">
                      {c.plan}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(c.created_at).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
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
