import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/server'
import { formatDateTime } from '@/lib/datetime'
import { auditLabel, auditTone, relativeTime } from '@/lib/audit-actions'
import { NotAuthorized } from '@/components/platform-admin/not-authorized'
import { Badge, EmptyPanel, Page, PageHeader } from '@/components/platform-admin/ui'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Audit logs' }

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

/** `{"status":"suspended"}` reads worse than `status: suspended`. */
function summarise(value: Record<string, unknown>): string {
  return Object.entries(value)
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v === null ? '—' : String(v)}`)
    .join(', ')
}

export default async function AuditLogs() {
  const supabase = await createClient()
  const { data: context } = await supabase.rpc('platform_admin_context')
  const permissions = (context as { permissions: Record<string, boolean> } | null)?.permissions ?? {}
  if (!permissions['audit.view']) return <NotAuthorized section="audit logs" />

  const { data } = await supabase
    .from('platform_audit_logs')
    .select('id, actor_id, action, target_type, target_id, previous_value, new_value, created_at')
    .order('created_at', { ascending: false })
    .limit(200)

  const logs = (data ?? []) as Row[]
  const actorIds = [...new Set(logs.map((l) => l.actor_id).filter(Boolean))] as string[]
  const cafeIds = [...new Set(logs.filter((l) => l.target_type === 'cafe').map((l) => l.target_id).filter(Boolean))] as string[]
  const adminIds = [...new Set(logs.filter((l) => l.target_type === 'admin').map((l) => l.target_id).filter(Boolean))] as string[]

  const [{ data: actors }, { data: cafes }, { data: admins }] = await Promise.all([
    actorIds.length ? supabase.from('profiles').select('id, full_name').in('id', actorIds) : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
    cafeIds.length ? supabase.from('cafes').select('id, name').in('id', cafeIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    adminIds.length ? supabase.from('platform_admins').select('id, full_name').in('id', adminIds) : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
  ])
  const actorName = new Map((actors ?? []).map((a) => [a.id, a.full_name]))
  const cafeName = new Map((cafes ?? []).map((c) => [c.id, c.name]))
  const adminName = new Map((admins ?? []).map((a) => [a.id, a.full_name]))

  return (
    <Page>
      <PageHeader
        title="Audit logs"
        subtitle={`Append-only record of platform administrative actions — ${logs.length} shown, most recent first.`}
      />

      {logs.length === 0 ? (
        <div className="mt-6">
          <EmptyPanel message="No administrative actions logged yet. Verifications, suspensions and plan changes will appear here." />
        </div>
      ) : (
        // A timeline rather than a stack of separate cards: these are one
        // continuous record, and the rail makes the chronology legible.
        <ol className="mt-6 border-l border-border pl-5">
          {logs.map((l) => (
            <li key={l.id} className="relative py-3.5 first:pt-0">
              <span className="absolute -left-[23px] top-[19px] h-1.5 w-1.5 rounded-full bg-border-strong first:top-[5px]" />
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13.5px] font-medium text-foreground">{auditLabel(l.action)}</span>
                  <Badge tone={auditTone(l.action)}>{l.target_type ?? 'platform'}</Badge>
                </div>
                <span className="text-[11.5px] tabular-nums text-muted-foreground" title={formatDateTime(l.created_at)}>
                  {relativeTime(l.created_at) ?? formatDateTime(l.created_at)}
                </span>
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
                {l.target_type === 'admin' && l.target_id && (
                  <>
                    {' · '}
                    <Link href="/platform-admin/admins" className="text-primary hover:underline">
                      {adminName.get(l.target_id) ?? 'admin'}
                    </Link>
                  </>
                )}
              </p>

              {(l.previous_value || l.new_value) && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px]">
                  {l.previous_value && (
                    <span className="rounded-[var(--radius-sm)] bg-surface-subtle px-2 py-1 text-muted-foreground line-through decoration-border-strong">
                      {summarise(l.previous_value)}
                    </span>
                  )}
                  {l.previous_value && l.new_value && <span className="text-muted-foreground">→</span>}
                  {l.new_value && (
                    <span className="rounded-[var(--radius-sm)] bg-surface-subtle px-2 py-1 text-foreground">
                      {summarise(l.new_value)}
                    </span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </Page>
  )
}
