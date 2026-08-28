'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { formatDateTime } from '@/lib/datetime'
import { auditLabel, auditTone, relativeTime } from '@/lib/audit-actions'
import { Badge, EmptyPanel, Page, PageHeader } from '@/components/ops/ui'

export type AuditLogRow = {
  id: string
  actor_id: string | null
  actor_name: string | null
  action: string
  target_type: string | null
  target_id: string | null
  target_name: string | null
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

export default function AuditLogsClient({ initialLogs }: { initialLogs: AuditLogRow[] }) {
  const supabase = useMemo(() => createClient(), [])
  const [logs, setLogs] = useState(initialLogs)
  const [search, setSearch] = useState('')
  const [action, setAction] = useState('')
  const [targetType, setTargetType] = useState('')
  const [actorId, setActorId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(false)

  // Options come only from rows actually fetched on first load — never
  // invented. An action or actor that has never fired doesn't appear as a
  // choice.
  const actionOptions = useMemo(() => [...new Set(initialLogs.map((l) => l.action))].sort(), [initialLogs])
  const actorOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const l of initialLogs) if (l.actor_id) seen.set(l.actor_id, l.actor_name ?? 'operator')
    return [...seen.entries()]
  }, [initialLogs])

  const run = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.rpc('op_list_audit_logs', {
      p_search: search || null,
      p_action: action || null,
      p_target_type: targetType || null,
      p_actor_id: actorId || null,
      p_from: from ? new Date(from).toISOString() : null,
      p_to: to ? new Date(`${to}T23:59:59`).toISOString() : null,
    })
    setLogs((data ?? []) as AuditLogRow[])
    setLoading(false)
  }, [supabase, search, action, targetType, actorId, from, to])

  useEffect(() => {
    const t = setTimeout(run, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, action, targetType, actorId, from, to])

  const filtersOn = Boolean(search || action || targetType || actorId || from || to)

  return (
    <Page>
      <PageHeader
        title="Audit logs"
        subtitle={
          filtersOn
            ? `${logs.length} matching, most recent first.`
            : `Append-only record of platform administrative actions — ${logs.length} shown, most recent first.`
        }
      />

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search action, actor, or target…"
            className="h-10 w-full rounded-[var(--radius)] border border-border-strong bg-surface pl-8 pr-3 text-[13.5px] text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <select value={action} onChange={(e) => setAction(e.target.value)} className="h-10 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[13px] text-foreground">
          <option value="">All actions</option>
          {actionOptions.map((a) => <option key={a} value={a}>{auditLabel(a)}</option>)}
        </select>
        <select value={targetType} onChange={(e) => setTargetType(e.target.value)} className="h-10 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[13px] text-foreground">
          <option value="">All targets</option>
          <option value="cafe">Café</option>
          <option value="admin">Admin</option>
          <option value="lead">Lead</option>
          <option value="alert">Alert</option>
        </select>
        {actorOptions.length > 1 && (
          <select value={actorId} onChange={(e) => setActorId(e.target.value)} className="h-10 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[13px] text-foreground">
            <option value="">All actors</option>
            {actorOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date"
          className="h-10 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[13px] text-foreground" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date"
          className="h-10 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[13px] text-foreground" />
      </div>

      <div className={`mt-6 transition-opacity ${loading ? 'opacity-60' : ''}`}>
        {logs.length === 0 ? (
          <EmptyPanel message={loading ? 'Searching…' : filtersOn ? 'No actions match these filters.' : 'No administrative actions logged yet. Verifications, suspensions and plan changes will appear here.'} />
        ) : (
          // A timeline rather than a stack of separate cards: these are one
          // continuous record, and the rail makes the chronology legible.
          <ol className="border-l border-border pl-5">
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
                  by {l.actor_id ? (l.actor_name ?? 'operator') : 'system'}
                  {l.target_type === 'cafe' && l.target_id && (
                    <>
                      {' · '}
                      <Link href={`/ops/cafes/${l.target_id}`} className="text-primary hover:underline">
                        {l.target_name ?? 'café'}
                      </Link>
                    </>
                  )}
                  {l.target_type === 'admin' && l.target_id && (
                    <>
                      {' · '}
                      <Link href="/ops/admins" className="text-primary hover:underline">
                        {l.target_name ?? 'admin'}
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
      </div>
    </Page>
  )
}
