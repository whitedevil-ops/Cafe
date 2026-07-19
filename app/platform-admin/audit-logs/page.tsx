import { createClient } from '@/utils/supabase/server'

export const dynamic = 'force-dynamic'

type Row = {
  id: string
  action: string
  target_type: string | null
  created_at: string
}

export default async function AuditLogs() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('platform_audit_logs')
    .select('id, action, target_type, created_at')
    .order('created_at', { ascending: false })
    .limit(200)

  const logs = (data ?? []) as Row[]

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Audit logs</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Append-only record of platform administrative actions.
      </p>

      {logs.length === 0 ? (
        <div className="mt-8 rounded-xl border border-border bg-surface p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No administrative actions logged yet. Verifications, suspensions, and plan changes
            will appear here.
          </p>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-border rounded-xl border border-border">
          {logs.map((l) => (
            <li key={l.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <span className="font-medium text-foreground">{l.action}</span>
              <span className="text-[12px] text-muted-foreground">
                {new Date(l.created_at).toLocaleString('en-IN')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
