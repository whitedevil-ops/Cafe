import Link from 'next/link'
import { createClient } from '@/utils/supabase/server'

export const dynamic = 'force-dynamic'

type Row = {
  id: string
  actor_id: string | null
  action: string
  target_type: string | null
  target_id: string | null
  previous_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  created_at: string
}

export default async function AuditLogs() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('platform_audit_logs')
    .select('id, actor_id, action, target_type, target_id, previous_value, new_value, created_at')
    .order('created_at', { ascending: false })
    .limit(200)

  const logs = (data ?? []) as Row[]
  const actorIds = [...new Set(logs.map((l) => l.actor_id).filter(Boolean))] as string[]
  const cafeIds = [...new Set(logs.filter((l) => l.target_type === 'cafe').map((l) => l.target_id).filter(Boolean))] as string[]

  const [{ data: actors }, { data: cafes }] = await Promise.all([
    actorIds.length ? supabase.from('profiles').select('id, full_name').in('id', actorIds) : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
    cafeIds.length ? supabase.from('cafes').select('id, name').in('id', cafeIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ])
  const actorName = new Map((actors ?? []).map((a) => [a.id, a.full_name]))
  const cafeName = new Map((cafes ?? []).map((c) => [c.id, c.name]))

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Audit logs</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Append-only record of platform administrative actions — {logs.length} shown, most recent first.
      </p>

      {logs.length === 0 ? (
        <div className="mt-8 rounded-xl border border-border bg-surface p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No administrative actions logged yet. Verifications, suspensions, and plan changes will appear here.
          </p>
        </div>
      ) : (
        <ul className="mt-6 space-y-2">
          {logs.map((l) => (
            <li key={l.id} className="rounded-[var(--radius)] border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13.5px] font-medium text-foreground">{l.action}</span>
                <span className="text-[11.5px] text-muted-foreground">{new Date(l.created_at).toLocaleString('en-IN')}</span>
              </div>
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                by {l.actor_id ? (actorName.get(l.actor_id) ?? 'operator') : 'system'}
                {l.target_type === 'cafe' && l.target_id && (
                  <>
                    {' · '}
                    <Link href={`/platform-admin/cafes/${l.target_id}`} className="text-primary hover:underline">
                      {cafeName.get(l.target_id) ?? 'café'}
                    </Link>
                  </>
                )}
              </p>
              {(l.previous_value || l.new_value) && (
                <div className="mt-2 flex flex-wrap gap-4 text-[11.5px]">
                  {l.previous_value && (
                    <span className="text-muted-foreground">before: <code className="text-foreground">{JSON.stringify(l.previous_value)}</code></span>
                  )}
                  {l.new_value && (
                    <span className="text-muted-foreground">after: <code className="text-foreground">{JSON.stringify(l.new_value)}</code></span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
