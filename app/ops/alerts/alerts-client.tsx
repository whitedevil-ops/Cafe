'use client'

import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { Check, CheckCheck } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { formatDateTime } from '@/lib/datetime'
import { relativeTime } from '@/lib/audit-actions'
import { Badge, EmptyPanel, Page, PageHeader, TableWrap, Td, Th, Thead, Tr, type StripTone } from '@/components/ops/ui'

export type AlertRow = {
  id: string
  cafe_id: string
  cafe_name: string
  alert_type: string
  severity: string
  message: string
  detected_at: string
  status: string
  acknowledged_by: string | null
  acknowledged_at: string | null
  resolved_by: string | null
  resolved_at: string | null
}

const STATUSES = ['open', 'acknowledged', 'resolved'] as const
const STATUS_LABEL: Record<string, string> = { open: 'Open', acknowledged: 'Acknowledged', resolved: 'Resolved' }
const TYPE_LABEL: Record<string, string> = {
  subscription_expiring: 'Subscription expiring',
  cafe_inactive: 'Café inactive',
  sms_failures: 'SMS failures',
}
const SEVERITY_TONE: Record<string, StripTone> = { critical: 'destructive', warning: 'warning' }

export default function AlertsClient({
  initialAlerts,
  initialStatus,
  canManage,
  actorName,
}: {
  initialAlerts: AlertRow[]
  initialStatus: string
  canManage: boolean
  actorName: Record<string, string | null>
}) {
  const supabase = useMemo(() => createClient(), [])
  const { toast } = useToast()
  const confirm = useConfirm()

  const [alerts, setAlerts] = useState(initialAlerts)
  const [status, setStatus] = useState(initialStatus)
  const [loading, setLoading] = useState(false)
  const [workingId, setWorkingId] = useState<string | null>(null)

  const run = useCallback(async (nextStatus: string) => {
    setLoading(true)
    const { data, error } = await supabase.rpc('op_list_alerts', { p_status: nextStatus })
    setLoading(false)
    if (error) return toast(error.message, 'error')
    setAlerts((data ?? []) as AlertRow[])
  }, [supabase, toast])

  async function switchStatus(next: string) {
    setStatus(next)
    const url = new URL(window.location.href)
    url.searchParams.set('status', next)
    window.history.replaceState({}, '', url)
    await run(next)
  }

  async function acknowledge(a: AlertRow) {
    setWorkingId(a.id)
    const { error } = await supabase.rpc('op_acknowledge_alert', { p_alert_id: a.id })
    setWorkingId(null)
    if (error) return toast(error.message, 'error')
    toast('Alert acknowledged.')
    void run(status)
  }

  async function resolve(a: AlertRow) {
    const ok = await confirm({
      title: 'Resolve this alert?',
      description: `${a.cafe_name} — ${a.message}. Moves to resolved history; reopens automatically if this signal is still true next time the list refreshes.`,
      confirmLabel: 'Resolve',
    })
    if (!ok) return
    setWorkingId(a.id)
    const { error } = await supabase.rpc('op_resolve_alert', { p_alert_id: a.id })
    setWorkingId(null)
    if (error) return toast(error.message, 'error')
    toast('Alert resolved.')
    void run(status)
  }

  return (
    <Page>
      <PageHeader
        title="Alert centre"
        subtitle="Subscription expiry, café inactivity, and failed SMS deliveries — the same signals as Café health, with a triage workflow."
      />

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => void switchStatus(s)}
            className={`h-9 rounded-full border px-3.5 text-[12.5px] font-medium transition-colors ${
              status === s ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong bg-surface text-muted-foreground hover:bg-surface-subtle'
            }`}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      <div className={`mt-5 transition-opacity ${loading ? 'opacity-60' : ''}`}>
        {alerts.length === 0 ? (
          <EmptyPanel message={loading ? 'Loading…' : status === 'open' ? 'No open alerts — nothing needs attention right now.' : `No ${status} alerts.`} />
        ) : (
          <TableWrap minWidth={860}>
            <Thead>
              <Th>Café</Th>
              <Th>Type</Th>
              <Th>Severity</Th>
              <Th>Message</Th>
              <Th align="right">Detected</Th>
              <Th>{null}</Th>
            </Thead>
            <tbody>
              {alerts.map((a) => (
                <Tr key={a.id}>
                  <Td><Link href={`/ops/cafes/${a.cafe_id}`} className="font-medium text-foreground hover:text-primary">{a.cafe_name}</Link></Td>
                  <Td muted>{TYPE_LABEL[a.alert_type] ?? a.alert_type}</Td>
                  <Td><Badge tone={SEVERITY_TONE[a.severity] ?? 'neutral'}>{a.severity}</Badge></Td>
                  <Td muted>{a.message}</Td>
                  <Td align="right" muted>
                    <span title={formatDateTime(a.detected_at)}>{relativeTime(a.detected_at) ?? formatDateTime(a.detected_at)}</span>
                  </Td>
                  <Td align="right">
                    <div className="flex justify-end gap-1.5">
                      {canManage && a.status === 'open' && (
                        <button onClick={() => acknowledge(a)} disabled={workingId === a.id}
                          className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-sm)] border border-border-strong px-2.5 text-[12px] font-medium text-foreground hover:bg-surface-subtle disabled:opacity-40">
                          <Check size={13} /> Acknowledge
                        </button>
                      )}
                      {canManage && a.status !== 'resolved' && (
                        <button onClick={() => resolve(a)} disabled={workingId === a.id}
                          className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-sm)] bg-primary px-2.5 text-[12px] font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-40">
                          <CheckCheck size={13} /> Resolve
                        </button>
                      )}
                      {a.status === 'resolved' && (
                        <span className="text-[11.5px] text-muted-foreground">{a.resolved_by ? `by ${actorName[a.resolved_by] ?? 'operator'}` : 'auto-resolved'}</span>
                      )}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </div>
    </Page>
  )
}
