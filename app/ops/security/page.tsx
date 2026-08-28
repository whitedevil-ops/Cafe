import type { Metadata } from 'next'
import { createClient } from '@/utils/supabase/server'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { auditLabel, auditTone, relativeTime } from '@/lib/audit-actions'
import { NotAuthorized } from '@/components/ops/not-authorized'
import { Badge, EmptyState, Page, PageHeader, Panel, TableWrap, Td, Th, Thead, Tr } from '@/components/ops/ui'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Security centre' }

// Exactly the 3 action strings op_update_admin_permissions / op_update_admin
// / op_set_admin_status write. 'admin.updated' (a plain name edit, same RPC
// as role_changed) is deliberately excluded — it isn't a permission/role/
// status change.
const PERMISSION_ACTIONS = ['admin.permissions_changed', 'admin.role_changed', 'admin.status_changed']

function When({ iso }: { iso: string }) {
  return <span title={formatDateTime(iso)}>{relativeTime(iso) ?? formatDate(iso)}</span>
}

type ResetRow = {
  id: string
  cafe_id: string | null
  target_email: string
  initiated_by: string | null
  status: string
  error: string | null
  created_at: string
}

type AuditRow = {
  id: string
  actor_id: string | null
  action: string
  target_id: string | null
  previous_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  created_at: string
}

type DeletionRow = {
  id: string
  cafe_name: string
  owner_email: string | null
  plan: string | null
  deleted_by_name: string | null
  deleted_at: string
  snapshot: Record<string, unknown>
}

/** Same helper as audit-logs — kept local rather than shared for a
 *  three-line function used in two places. */
function summarise(value: Record<string, unknown>): string {
  return Object.entries(value)
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v === null ? '—' : String(v)}`)
    .join(', ')
}

export default async function SecurityCentre() {
  const supabase = await createClient()
  const { data: context } = await supabase.rpc('platform_admin_context')
  const permissions = (context as { permissions: Record<string, boolean> } | null)?.permissions ?? {}

  // Gated on audit.view, not a new dedicated key — every source this page
  // reads is already scoped to exactly this permission (RLS on
  // password_reset_log/platform_audit_logs, list_cafe_deletions()'s own
  // check). A distinct key would have to be kept in permanent lockstep with
  // audit.view across every role or an admin granted one without the other
  // sees an empty/broken page.
  if (!permissions['audit.view']) return <NotAuthorized section="the security centre" />

  const [{ data: resetData }, { data: auditData }, { data: deletionData }] = await Promise.all([
    supabase
      .from('password_reset_log')
      .select('id, cafe_id, target_email, initiated_by, status, error, created_at')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('platform_audit_logs')
      .select('id, actor_id, action, target_id, previous_value, new_value, created_at')
      .in('action', PERMISSION_ACTIONS)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase.rpc('list_cafe_deletions', { p_limit: 50 }),
  ])

  const resets = (resetData ?? []) as ResetRow[]
  const permChanges = (auditData ?? []) as AuditRow[]
  const deletions = (deletionData ?? []) as DeletionRow[]

  const cafeIds = [...new Set(resets.map((r) => r.cafe_id).filter(Boolean))] as string[]
  const initiatorIds = [...new Set(resets.map((r) => r.initiated_by).filter(Boolean))] as string[]
  const actorIds = [...new Set(permChanges.map((a) => a.actor_id).filter(Boolean))] as string[]
  const adminTargetIds = [...new Set(permChanges.map((a) => a.target_id).filter(Boolean))] as string[]

  const [{ data: cafes }, { data: initiators }, { data: actors }, { data: admins }] = await Promise.all([
    cafeIds.length ? supabase.from('cafes').select('id, name').in('id', cafeIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    initiatorIds.length ? supabase.from('profiles').select('id, full_name').in('id', initiatorIds) : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
    actorIds.length ? supabase.from('profiles').select('id, full_name').in('id', actorIds) : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
    adminTargetIds.length ? supabase.from('platform_admins').select('id, full_name').in('id', adminTargetIds) : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
  ])
  const cafeName = new Map((cafes ?? []).map((c) => [c.id, c.name]))
  const initiatorName = new Map((initiators ?? []).map((p) => [p.id, p.full_name]))
  const actorName = new Map((actors ?? []).map((p) => [p.id, p.full_name]))
  const adminName = new Map((admins ?? []).map((a) => [a.id, a.full_name]))

  return (
    <Page>
      <PageHeader
        title="Security centre"
        subtitle="Password resets, admin permission changes, and café deletions — already-recorded sensitive actions, gathered in one place."
      />

      <div className="mt-6 space-y-4">
        <Panel title="Password resets">
          {resets.length === 0 ? (
            <EmptyState message="No password resets have been sent yet." />
          ) : (
            <div className="-mx-5 -mb-4">
              <TableWrap minWidth={640}>
                <Thead>
                  <Th>Target</Th>
                  <Th>Café</Th>
                  <Th>Initiated by</Th>
                  <Th>Status</Th>
                  <Th align="right">When</Th>
                </Thead>
                <tbody>
                  {resets.map((r) => (
                    <Tr key={r.id}>
                      <Td>{r.target_email}</Td>
                      <Td muted>{r.cafe_id ? (cafeName.get(r.cafe_id) ?? '—') : 'Admin account'}</Td>
                      <Td muted>{r.initiated_by ? (initiatorName.get(r.initiated_by) ?? 'operator') : 'system'}</Td>
                      <Td>
                        <Badge tone={r.status === 'sent' ? 'success' : 'destructive'}>{r.status}</Badge>
                        {r.error && <p className="mt-1 text-[11.5px] text-destructive">{r.error}</p>}
                      </Td>
                      <Td align="right" muted><When iso={r.created_at} /></Td>
                    </Tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>
          )}
        </Panel>

        <Panel title="Permission changes">
          {permChanges.length === 0 ? (
            <EmptyState message="No admin role, status, or permission change has been made yet." />
          ) : (
            <div className="-mx-5 -mb-4">
              <TableWrap minWidth={640}>
                <Thead>
                  <Th>Change</Th>
                  <Th>Admin</Th>
                  <Th>By</Th>
                  <Th align="right">When</Th>
                </Thead>
                <tbody>
                  {permChanges.map((a) => (
                    <Tr key={a.id}>
                      <Td>
                        <Badge tone={auditTone(a.action)}>{auditLabel(a.action)}</Badge>
                        {(a.previous_value || a.new_value) && (
                          <p className="mt-1 text-[11.5px] text-muted-foreground">
                            {a.previous_value && <span className="line-through decoration-border-strong">{summarise(a.previous_value)}</span>}
                            {a.previous_value && a.new_value && ' → '}
                            {a.new_value && summarise(a.new_value)}
                          </p>
                        )}
                      </Td>
                      <Td muted>{a.target_id ? (adminName.get(a.target_id) ?? 'admin') : '—'}</Td>
                      <Td muted>{a.actor_id ? (actorName.get(a.actor_id) ?? 'operator') : 'system'}</Td>
                      <Td align="right" muted><When iso={a.created_at} /></Td>
                    </Tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>
          )}
        </Panel>

        <Panel title="Café deletions">
          {deletions.length === 0 ? (
            <EmptyState message="No café has been permanently deleted." />
          ) : (
            <div className="-mx-5 -mb-4">
              <TableWrap minWidth={640}>
                <Thead>
                  <Th>Café</Th>
                  <Th>Owner</Th>
                  <Th>Plan</Th>
                  <Th>Deleted by</Th>
                  <Th align="right">When</Th>
                </Thead>
                <tbody>
                  {deletions.map((d) => (
                    <Tr key={d.id}>
                      <Td>{d.cafe_name}</Td>
                      <Td muted>{d.owner_email ?? '—'}</Td>
                      <Td muted><span className="capitalize">{d.plan ?? '—'}</span></Td>
                      <Td muted>{d.deleted_by_name ?? 'operator'}</Td>
                      <Td align="right" muted><When iso={d.deleted_at} /></Td>
                    </Tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>
          )}
        </Panel>
      </div>
    </Page>
  )
}
