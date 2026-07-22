'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ShieldCheck, ShieldOff, ArrowLeft, Key, StickyNote } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { ReasonDialog } from '@/components/operator/reason-dialog'

export type CafeDetail = {
  business: {
    id: string; name: string; logo_url: string | null; owner_name: string | null; owner_email: string | null
    owner_phone: string | null; phone: string | null; address: string | null; city: string | null
    state: string | null; pincode: string | null; gstin: string | null; created_at: string
  }
  account: {
    status: string; status_reason: string | null; status_changed_at: string | null; verified: boolean
    verified_at: string | null; plan: string; trial_ends_at: string | null; subscription_ends_at: string | null
  }
  usage: {
    staff_count: number; menu_items_count: number; tables_count: number; customers_count: number
    orders_count: number; last_order_at: string | null
  }
  onboarding: {
    account_created: boolean; profile_completed: boolean; menu_added: boolean; tables_created: boolean
    qr_generated: boolean; staff_added: boolean; first_order_placed: boolean
  } | null
  features: { plan_defaults: Record<string, boolean>; overrides: { feature_key: string; enabled: boolean; set_at: string }[] }
  notes: { id: string; note: string; created_by_name: string | null; created_at: string }[]
  recent_audit: { action: string; previous_value: unknown; new_value: unknown; created_at: string; actor_name: string | null }[]
}

const FEATURES: { key: string; label: string }[] = [
  { key: 'qr_ordering', label: 'QR Ordering' },
  { key: 'kds', label: 'KDS' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'reservations', label: 'Reservations' },
  { key: 'crm', label: 'CRM' },
  { key: 'advanced_analytics', label: 'Advanced Analytics' },
  { key: 'sms_bills', label: 'SMS Bills' },
  { key: 'multi_staff', label: 'Multiple Staff' },
  { key: 'advanced_reports', label: 'Advanced Reports' },
]

const STATUS_ACTIONS: { to: string; label: string; destructive: boolean }[] = [
  { to: 'active', label: 'Activate', destructive: false },
  { to: 'suspended', label: 'Suspend', destructive: true },
  { to: 'disabled', label: 'Disable', destructive: true },
  { to: 'archived', label: 'Archive', destructive: true },
]

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('en-IN')

export default function CafeDetailClient({
  cafeId,
  detail,
  plans,
}: {
  cafeId: string
  detail: CafeDetail
  plans: { key: string; name: string; price_monthly: number }[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const { toast } = useToast()
  const confirm = useConfirm()
  const [data, setData] = useState(detail)
  const [statusDialog, setStatusDialog] = useState<{ to: string; label: string; destructive: boolean } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [addingNote, setAddingNote] = useState(false)
  const [subEndsAt, setSubEndsAt] = useState(data.account.subscription_ends_at?.slice(0, 10) ?? '')
  const [resettingPw, setResettingPw] = useState(false)

  async function refresh() {
    const { data: fresh } = await supabase.rpc('op_get_cafe_detail', { p_cafe_id: cafeId })
    if (fresh) setData(fresh as CafeDetail)
  }

  async function toggleVerified() {
    const next = !data.account.verified
    const ok = await confirm({
      title: next ? 'Verify this café?' : 'Remove verification?',
      description: next ? 'A verified badge will show wherever appropriate in the app.' : 'The verified badge will be removed.',
      confirmLabel: next ? 'Verify' : 'Remove',
    })
    if (!ok) return
    const { error } = await supabase.rpc('op_verify_cafe', { p_cafe_id: cafeId, p_verified: next })
    if (error) return toast(error.message, 'error')
    toast(next ? 'Café verified.' : 'Verification removed.')
    void refresh()
  }

  async function submitStatusChange(reason: string) {
    if (!statusDialog) return
    setSubmitting(true)
    setDialogError(null)
    const { error } = await supabase.rpc('op_set_cafe_status', { p_cafe_id: cafeId, p_status: statusDialog.to, p_reason: reason })
    setSubmitting(false)
    if (error) return setDialogError(error.message)
    toast(`Café status changed to ${statusDialog.to}.`)
    setStatusDialog(null)
    void refresh()
  }

  async function changePlan(planKey: string) {
    const { error } = await supabase.rpc('op_change_plan', { p_cafe_id: cafeId, p_plan_key: planKey })
    if (error) return toast(error.message, 'error')
    toast(`Plan changed to ${planKey}.`)
    void refresh()
  }

  async function extendSubscription() {
    if (!subEndsAt) return
    const { error } = await supabase.rpc('op_extend_subscription', {
      p_cafe_id: cafeId, p_subscription_ends_at: new Date(subEndsAt).toISOString(),
    })
    if (error) return toast(error.message, 'error')
    toast('Subscription updated.')
    void refresh()
  }

  async function toggleFeature(key: string, current: boolean | null) {
    const next = current === null ? !data.features.plan_defaults[key] : !current
    const { error } = await supabase.rpc('op_set_feature_override', { p_cafe_id: cafeId, p_feature_key: key, p_enabled: next })
    if (error) return toast(error.message, 'error')
    void refresh()
  }

  async function clearOverride(key: string) {
    const { error } = await supabase.rpc('op_clear_feature_override', { p_cafe_id: cafeId, p_feature_key: key })
    if (error) return toast(error.message, 'error')
    toast('Reverted to plan default.')
    void refresh()
  }

  async function addNote() {
    if (!note.trim()) return
    setAddingNote(true)
    const { error } = await supabase.rpc('op_add_operator_note', { p_cafe_id: cafeId, p_note: note.trim() })
    setAddingNote(false)
    if (error) return toast(error.message, 'error')
    setNote('')
    void refresh()
  }

  async function resetPassword() {
    const ok = await confirm({
      title: 'Reset owner password?',
      description: `Sends a secure password-reset link to ${data.business.owner_email}. No password is ever shown or stored.`,
      confirmLabel: 'Send reset link',
    })
    if (!ok) return
    setResettingPw(true)
    const res = await fetch('/api/platform-admin/reset-owner-password', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cafe_id: cafeId }),
    })
    setResettingPw(false)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return toast(body.error ?? 'Could not send reset link.', 'error')
    toast(`Reset link sent to ${body.email}.`)
  }

  const overrideByKey = new Map(data.features.overrides.map((o) => [o.feature_key, o.enabled]))
  const onboardingFlags = data.onboarding
    ? [
        ['Account created', data.onboarding.account_created],
        ['Café profile completed', data.onboarding.profile_completed],
        ['Menu added', data.onboarding.menu_added],
        ['Tables created', data.onboarding.tables_created],
        ['QR generated', data.onboarding.qr_generated],
        ['Staff added', data.onboarding.staff_added],
        ['First order placed', data.onboarding.first_order_placed],
      ] as const
    : []
  const onboardingPct = onboardingFlags.length
    ? Math.round((onboardingFlags.filter(([, v]) => v).length / onboardingFlags.length) * 100)
    : 0

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <Link href="/platform-admin/cafes" className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft size={14} /> All cafés
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{data.business.name}</h1>
        {data.account.verified && (
          <span className="flex items-center gap-1 rounded-full bg-primary-subtle px-2.5 py-1 text-[12px] font-medium text-primary">
            <ShieldCheck size={13} /> Verified
          </span>
        )}
        <span className="rounded-full bg-surface-subtle px-2.5 py-1 text-[12px] font-medium capitalize text-foreground">{data.account.status}</span>
      </div>
      {data.account.status_reason && (
        <p className="mt-1 text-[13px] text-muted-foreground">Reason: {data.account.status_reason}</p>
      )}

      {/* Business */}
      <section className="mt-6 rounded-xl border border-border bg-surface p-5">
        <p className="text-sm font-medium text-foreground">Business</p>
        <div className="mt-3 grid grid-cols-2 gap-3 text-[13.5px] sm:grid-cols-3">
          <Field label="Owner" value={data.business.owner_name} />
          <Field label="Email" value={data.business.owner_email} />
          <Field label="Phone" value={data.business.owner_phone ?? data.business.phone} />
          <Field label="City" value={data.business.city} />
          <Field label="Address" value={data.business.address} />
          <Field label="GSTIN" value={data.business.gstin} />
          <Field label="Registered" value={fmt(data.business.created_at)} />
        </div>
      </section>

      {/* Account + verification + status control */}
      <section className="mt-6 rounded-xl border border-border bg-surface p-5">
        <p className="text-sm font-medium text-foreground">Account</p>
        <div className="mt-3 grid grid-cols-2 gap-3 text-[13.5px] sm:grid-cols-3">
          <Field label="Plan" value={data.account.plan} capitalize />
          <Field label="Trial ends" value={fmt(data.account.trial_ends_at)} />
          <Field label="Subscription ends" value={fmt(data.account.subscription_ends_at)} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={toggleVerified} className="flex min-h-10 items-center gap-1.5 rounded-[var(--radius)] border border-border-strong px-3.5 text-[13px] font-medium text-foreground hover:bg-surface-subtle">
            {data.account.verified ? <ShieldOff size={14} /> : <ShieldCheck size={14} />}
            {data.account.verified ? 'Remove verification' : 'Verify café'}
          </button>
          <button onClick={resetPassword} disabled={resettingPw || !data.business.owner_email} className="flex min-h-10 items-center gap-1.5 rounded-[var(--radius)] border border-border-strong px-3.5 text-[13px] font-medium text-foreground hover:bg-surface-subtle disabled:opacity-40">
            <Key size={14} /> {resettingPw ? 'Sending…' : 'Reset owner password'}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {STATUS_ACTIONS.filter((a) => a.to !== data.account.status).map((a) => (
            <button
              key={a.to}
              onClick={() => { setDialogError(null); setStatusDialog(a) }}
              className={`min-h-9 rounded-[var(--radius-sm)] border px-3 text-[12.5px] font-medium ${
                a.destructive ? 'border-destructive text-destructive hover:bg-destructive-subtle' : 'border-border-strong text-foreground hover:bg-surface-subtle'
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <label className="text-[13px] text-muted-foreground">Change plan:</label>
          <select
            value={data.account.plan}
            onChange={(e) => changePlan(e.target.value)}
            className="h-9 rounded-[var(--radius-sm)] border border-border-strong bg-surface px-2 text-[13px] text-foreground"
          >
            {plans.map((p) => (
              <option key={p.key} value={p.key}>{p.name} — ₹{p.price_monthly}/mo</option>
            ))}
          </select>
          <label className="ml-4 text-[13px] text-muted-foreground">Subscription ends:</label>
          <input type="date" value={subEndsAt} onChange={(e) => setSubEndsAt(e.target.value)} className="h-9 rounded-[var(--radius-sm)] border border-border-strong bg-surface px-2 text-[13px] text-foreground" />
          <button onClick={extendSubscription} className="h-9 rounded-[var(--radius-sm)] bg-primary px-3 text-[12.5px] font-medium text-primary-foreground">Save</button>
        </div>
      </section>

      {/* Usage */}
      <section className="mt-6 rounded-xl border border-border bg-surface p-5">
        <p className="text-sm font-medium text-foreground">Usage</p>
        <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
          {[
            ['Staff', data.usage.staff_count],
            ['Menu items', data.usage.menu_items_count],
            ['Tables', data.usage.tables_count],
            ['Customers', data.usage.customers_count],
            ['Orders', data.usage.orders_count],
          ].map(([label, value]) => (
            <div key={label as string}>
              <p className="text-[11.5px] text-muted-foreground">{label}</p>
              <p className="mt-0.5 text-[17px] font-semibold text-foreground">{value}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[12.5px] text-muted-foreground">Last order: {data.usage.last_order_at ? fmtDateTime(data.usage.last_order_at) : 'None yet'}</p>
      </section>

      {/* Onboarding */}
      {data.onboarding && (
        <section className="mt-6 rounded-xl border border-border bg-surface p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">Onboarding</p>
            <span className="text-[13px] font-semibold text-foreground">{onboardingPct}%</span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-subtle">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${onboardingPct}%` }} />
          </div>
          <ul className="mt-3 space-y-1.5">
            {onboardingFlags.map(([label, done]) => (
              <li key={label} className="flex items-center gap-2 text-[13px]">
                <span className={done ? 'text-primary' : 'text-muted-foreground'}>{done ? '✓' : '○'}</span>
                <span className={done ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Feature control */}
      <section className="mt-6 rounded-xl border border-border bg-surface p-5">
        <p className="text-sm font-medium text-foreground">Feature control</p>
        <p className="mt-1 text-[12.5px] text-muted-foreground">Overrides beat the plan default. Toggling sets an explicit override for this café only.</p>
        <ul className="mt-3 divide-y divide-border">
          {FEATURES.map((f) => {
            const override = overrideByKey.has(f.key) ? overrideByKey.get(f.key)! : null
            const effective = override ?? data.features.plan_defaults[f.key] ?? false
            return (
              <li key={f.key} className="flex items-center justify-between py-2.5 text-[13.5px]">
                <div>
                  <span className="text-foreground">{f.label}</span>
                  {override !== null && <span className="ml-2 text-[11px] text-warning">override</span>}
                </div>
                <div className="flex items-center gap-2">
                  {override !== null && (
                    <button onClick={() => clearOverride(f.key)} className="text-[11.5px] text-muted-foreground hover:underline">Reset</button>
                  )}
                  <button
                    onClick={() => toggleFeature(f.key, override)}
                    className={`h-6 w-11 rounded-full transition-colors ${effective ? 'bg-primary' : 'bg-surface-subtle'}`}
                  >
                    <span className={`block h-5 w-5 rounded-full bg-white shadow transition-transform ${effective ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      {/* Operator notes */}
      <section className="mt-6 rounded-xl border border-border bg-surface p-5">
        <p className="flex items-center gap-1.5 text-sm font-medium text-foreground"><StickyNote size={14} /> Operator notes</p>
        <p className="mt-1 text-[12px] text-muted-foreground">Private — never visible to the café.</p>
        <div className="mt-3 flex gap-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note…" className="h-10 flex-1 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[13.5px] text-foreground placeholder:text-muted-foreground" />
          <button onClick={addNote} disabled={addingNote || !note.trim()} className="h-10 rounded-[var(--radius)] bg-primary px-4 text-[13px] font-medium text-primary-foreground disabled:opacity-40">Add</button>
        </div>
        <ul className="mt-3 space-y-2">
          {data.notes.map((n) => (
            <li key={n.id} className="rounded-[var(--radius)] bg-surface-subtle p-3 text-[13px]">
              <p className="text-foreground">{n.note}</p>
              <p className="mt-1 text-[11.5px] text-muted-foreground">{n.created_by_name ?? 'Operator'} · {fmtDateTime(n.created_at)}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Recent audit for this café */}
      <section className="mt-6 rounded-xl border border-border bg-surface p-5">
        <p className="text-sm font-medium text-foreground">Recent activity on this café</p>
        {data.recent_audit.length === 0 ? (
          <p className="mt-2 text-[13px] text-muted-foreground">No operator actions logged yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {data.recent_audit.map((a, i) => (
              <li key={i} className="text-[13px]">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">{a.action}</span>
                  <span className="text-[11.5px] text-muted-foreground">{fmtDateTime(a.created_at)}</span>
                </div>
                <p className="text-[11.5px] text-muted-foreground">by {a.actor_name ?? 'operator'}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {statusDialog && (
        <ReasonDialog
          title={`${statusDialog.label} ${data.business.name}?`}
          description="This takes effect immediately for staff and QR ordering."
          confirmLabel={statusDialog.label}
          destructive={statusDialog.destructive}
          submitting={submitting}
          error={dialogError}
          onClose={() => setStatusDialog(null)}
          onConfirm={submitStatusChange}
        />
      )}
    </div>
  )
}

function Field({ label, value, capitalize }: { label: string; value: string | null; capitalize?: boolean }) {
  return (
    <div>
      <p className="text-[11.5px] text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-foreground ${capitalize ? 'capitalize' : ''}`}>{value || '—'}</p>
    </div>
  )
}
