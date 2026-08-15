'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { formatDateTime } from '@/lib/datetime'

export type LeadRow = {
  id: string
  full_name: string
  phone: string
  email: string | null
  business_name: string | null
  city: string | null
  message: string | null
  status: string
  created_at: string
}

export type NotificationEmailRow = { id: string; email: string; created_at: string }

const STATUS_STYLE: Record<string, string> = {
  new: 'border-warning bg-warning-subtle text-warning',
  contacted: 'border-primary bg-primary-subtle text-primary',
  converted: 'border-success bg-success-subtle text-success',
  dismissed: 'border-border bg-surface-subtle text-muted-foreground',
}

const STATUSES = ['new', 'contacted', 'converted', 'dismissed']

export default function LeadsClient({
  initialLeads,
  initialNotificationEmails,
  canManage,
}: {
  initialLeads: LeadRow[]
  initialNotificationEmails: NotificationEmailRow[]
  canManage: boolean
}) {
  const supabase = useMemo(() => createClient(), [])
  const { toast } = useToast()
  const confirm = useConfirm()

  const [leads, setLeads] = useState(initialLeads)
  const [emails, setEmails] = useState(initialNotificationEmails)
  const [newEmail, setNewEmail] = useState('')
  const [adding, setAdding] = useState(false)

  async function setStatus(lead: LeadRow, status: string) {
    const { error } = await supabase.rpc('op_update_lead_status', { p_lead_id: lead.id, p_status: status })
    if (error) return toast(error.message, 'error')
    setLeads((rows) => rows.map((r) => (r.id === lead.id ? { ...r, status } : r)))
  }

  async function addEmail(e: React.FormEvent) {
    e.preventDefault()
    if (!newEmail.trim()) return
    setAdding(true)
    const { data, error } = await supabase.rpc('op_add_lead_notification_email', { p_email: newEmail.trim() })
    setAdding(false)
    if (error) return toast(error.message, 'error')
    setEmails((rows) => [...rows, { id: data as string, email: newEmail.trim().toLowerCase(), created_at: new Date().toISOString() }])
    setNewEmail('')
    toast('Email added.')
  }

  async function removeEmail(row: NotificationEmailRow) {
    const ok = await confirm({
      title: `Remove ${row.email}?`,
      description: 'This address will no longer receive new-lead notification emails.',
      confirmLabel: 'Remove',
      destructive: true,
    })
    if (!ok) return
    const { error } = await supabase.rpc('op_remove_lead_notification_email', { p_id: row.id })
    if (error) return toast(error.message, 'error')
    setEmails((rows) => rows.filter((r) => r.id !== row.id))
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Leads</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        People who tapped &quot;Start free&quot; on the website — {leads.length} total, most recent first.
      </p>

      {canManage && (
        <div className="mt-6 rounded-xl border border-border bg-surface p-5">
          <p className="text-sm font-medium text-foreground">Notification emails</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">Everyone on this list gets emailed when a new lead comes in.</p>
          <ul className="mt-3 space-y-1.5">
            {emails.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 text-[13.5px]">
                <span className="text-foreground">{e.email}</span>
                <button onClick={() => removeEmail(e)} className="text-[12px] text-muted-foreground hover:text-destructive">
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <form onSubmit={addEmail} className="mt-3 flex gap-2">
            <input
              type="email"
              placeholder="name@example.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="h-9 flex-1 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground"
            />
            <button
              type="submit"
              disabled={adding}
              className="h-9 rounded-[var(--radius)] bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
            >
              Add
            </button>
          </form>
        </div>
      )}

      {leads.length === 0 ? (
        <div className="mt-8 rounded-xl border border-border bg-surface p-10 text-center">
          <p className="text-sm text-muted-foreground">No leads yet — they&apos;ll show up here as visitors submit the &quot;Start free&quot; form.</p>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {leads.map((l) => (
            <li key={l.id} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[14.5px] font-medium text-foreground">
                    {l.full_name}
                    {l.business_name && <span className="text-muted-foreground"> · {l.business_name}</span>}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                    {l.phone}
                    {l.email && ` · ${l.email}`}
                    {l.city && ` · ${l.city}`}
                  </p>
                  {l.message && <p className="mt-2 text-[13px] text-foreground">{l.message}</p>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <span className="text-[11px] text-muted-foreground">{formatDateTime(l.created_at)}</span>
                  <select
                    value={l.status}
                    onChange={(e) => setStatus(l, e.target.value)}
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[l.status] ?? STATUS_STYLE.new}`}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
