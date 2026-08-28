import type { Metadata } from 'next'
import { createClient } from '@/utils/supabase/server'
import { NotAuthorized } from '@/components/ops/not-authorized'
import { Page, PageHeader } from '@/components/ops/ui'
import AuditLogsClient, { type AuditLogRow } from './audit-logs-client'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Audit logs' }

export default async function AuditLogs() {
  const supabase = await createClient()
  const { data: context } = await supabase.rpc('platform_admin_context')
  const permissions = (context as { permissions: Record<string, boolean> } | null)?.permissions ?? {}
  if (!permissions['audit.view']) return <NotAuthorized section="audit logs" />

  const { data, error } = await supabase.rpc('op_list_audit_logs', {})

  // A deploy can land before its migration is run. Say which one is missing
  // rather than throwing a 500 that looks like the console is broken — same
  // posture as the Users page.
  if (error) {
    return (
      <Page>
        <PageHeader title="Audit logs" />
        <p className="mt-6 rounded-[var(--radius)] border border-warning bg-warning-subtle px-4 py-3 text-sm text-warning">
          Could not load audit logs: {error.message}
          <br />
          <span className="text-[13px]">
            If this is new, run <code className="font-mono">0173_op_list_audit_logs.sql</code> in
            the Supabase SQL editor, then reload.
          </span>
        </p>
      </Page>
    )
  }

  return <AuditLogsClient initialLogs={(data ?? []) as AuditLogRow[]} />
}
