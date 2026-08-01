'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ShieldCheck, ShieldOff, ArrowLeft, Key, StickyNote } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { ReasonDialog } from '@/components/operator/reason-dialog'
import { DeleteCafeDialog } from '@/components/platform-admin/delete-cafe-dialog'
import { formatDate, formatDateTime } from '@/lib/datetime'

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

// Every key here is actually checked by app code (see lib/entitlements.ts
// callers, plus public_cafe_ordering_enabled for qr_ordering) — this list
// intentionally excludes keys platform_plans.features still carries but
// nothing reads: kds (core kitchen infra, every tier defaults true by
// design — paywalling it risks breaking a live kitchen), and multi_staff
// (seat limits are real, but enforced via the numeric platform_plans.
// max_staff column, not this boolean). reservations (0100) and
// advanced_analytics (0101) now have real features and are included below.
const FEATURES: { key: string; label: string }[] = [
  { key: 'qr_ordering', label: 'QR Ordering (kill switch)' },
  { key: 'online_payments', label: 'Online Payments (Razorpay)' },
  { key: 'coupons', label: 'Coupons' },
  { key: 'loyalty', label: 'Loyalty & Rewards' },
  { key: 'wallet', label: 'Customer Wallet' },
  { key: 'reservations', label: 'Table Reservations' },
  { key: 'advanced_analytics', label: 'Advanced Analytics' },
  { key: 'sms_bills', label: 'SMS Bill Receipts' },
  { key: 'feedback', label: 'Customer Feedback' },
  { key: 'expenses', label: 'Expenses Tracking' },
  { key: 'crm', label: 'Customer Directory (CRM)' },
  { key: 'inventory', label: 'Inventory, Recipes & Purchases' },
  { key: 'advanced_reports', label: 'Advanced Reports' },
  { key: 'referral', label: 'Refer & Earn (Scale default)' },
]

// Same three headings as the café dashboard's own sidebar (components/shell/
// app-shell.tsx) — Operations/Management/Business — so an operator reads this
// list the same way a café owner reads their own nav, not a separate taxonomy.
// Every FEATURES key appears in exactly one group, matched against the real
// nav item each key actually gates there:
//   Management: Customers(crm), Feedback, Inventory/Purchases/Recipes(inventory),
//   Coupons, Loyalty, Wallet, Reservations, Analytics(advanced_analytics),
//   Reports(advanced_reports gates 4 of its sub-pages), Expenses — all 10 of
//   these are literally in app-shell's Management group, not Business.
//   qr_ordering/sms_bills/online_payments gate no nav item directly (they're
//   capabilities within the ordering/billing flow, not their own screen) —
//   placed by what they're closest to in spirit: the first two affect live
//   order-taking (Operations), online_payments is a billing/financial
//   concern (Business, where subscription Billing itself lives).
const FEATURE_GROUPS: { heading: string; keys: string[] }[] = [
  { heading: 'Operations', keys: ['qr_ordering', 'sms_bills'] },
  { heading: 'Management', keys: ['crm', 'feedback', 'inventory', 'coupons', 'loyalty', 'wallet', 'reservations', 'advanced_analytics', 'advanced_reports', 'expenses', 'referral'] },
  { heading: 'Business', keys: ['online_payments'] },
]

// Not gated on anything — every café gets these regardless of plan, so
// there's no toggle for them. Listed read-only so an operator sees the
// café's full feature set in one place, not just the plan-gated subset.
const ALWAYS_INCLUDED: string[] = [
  'QR ordering', 'Digital menu builder', 'POS billing', 'Kitchen Display System (KDS)',
  'Live Tables', 'Discounts, held orders, cancel with reason', 'Bills & GST invoicing',
  'Digital receipts', 'Customer "My Orders"', 'Cash shift & drawer reconciliation',
  'Waiter tableside quick-add', 'Real-time sync', 'Pay at Counter + customer UPI',
  'Staff accounts & roles', 'Per-role screen access control', 'Café profile & settings',
  'Sales report', 'Owner Command Center',
]

const STATUS_ACTIONS: { to: string; label: string; destructive: boolean }[] = [
  { to: 'active', label: 'Activate', destructive: false },
  { to: 'suspended', label: 'Suspend', destructive: true },
  { to: 'disabled', label: 'Disable', destructive: true },
  { to: 'archived', label: 'Archive', destructive: true },
]

const fmt = (iso: string | null) => formatDate(iso)
const fmtDateTime = (iso: string) => formatDateTime(iso)

export default function CafeDetailClient({
  cafeId,
  detail,
  plans,
  permissions,
}: {
  cafeId: string
  detail: CafeDetail
  plans: { key: string; name: string; price_monthly: number; price_yearly: number | null }[]
  permissions: Record<string, boolean>
}) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const { toast } = useToast()
  const confirm = useConfirm()
  const [data, setData] = useState(detail)
  const [statusDialog, setStatusDialog] = useState<{ to: string; label: string; destructive: boolean } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [addingNote, setAddingNote] = useState(false)
  const [subEndsAt, setSubEndsAt] = useState(data.account.subscription_ends_at?.slice(0, 10) ?? '')
  const [planKey, setPlanKey] = useState(data.account.plan)
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10))
  const [applyingPlan, setApplyingPlan] = useState(false)
  const [resettingPw, setResettingPw] = useState(false)
  const [bulkSetting, setBulkSetting] = useState(false)
  const [featureTab, setFeatureTab] = useState<'plan' | 'manual'>('plan')
  const [deleting, setDeleting] = useState(false)
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

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

  async function applyPlan() {
    setApplyingPlan(true)
    const { data: newEndsAt, error } = await supabase.rpc('op_change_plan', {
      p_cafe_id: cafeId, p_plan_key: planKey, p_effective_date: new Date(effectiveDate).toISOString(),
    })
    setApplyingPlan(false)
    if (error) return toast(error.message, 'error')
    toast(`Plan set to ${planKey} — active until ${fmt(newEndsAt as string)}.`)
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

  async function setAllFeatures(enabled: boolean) {
    const ok = await confirm({
      title: enabled ? 'Turn on every feature?' : 'Turn off every feature?',
      description: enabled
        ? 'Sets an explicit override to ON for all features below, for this café only.'
        : 'Sets an explicit override to OFF for all features below, for this café only — this can take away things the café is actively using.',
      confirmLabel: enabled ? 'Turn all on' : 'Turn all off',
    })
    if (!ok) return
    setBulkSetting(true)
    const results = await Promise.all(
      FEATURES.map((f) => supabase.rpc('op_set_feature_override', { p_cafe_id: cafeId, p_feature_key: f.key, p_enabled: enabled })),
    )
    setBulkSetting(false)
    const failed = results.find((r) => r.error)
    if (failed?.error) return toast(failed.error.message, 'error')
    toast(enabled ? 'All features turned on.' : 'All features turned off.')
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

  async function confirmDelete() {
    setDeleteSubmitting(true)
    setDeleteError(null)
    const { error } = await supabase.rpc('op_delete_cafe', { p_cafe_id: cafeId, p_confirm_name: data.business.name })
    setDeleteSubmitting(false)
    if (error) return setDeleteError(error.message)
    toast(`${data.business.name} permanently deleted.`)
    router.push('/platform-admin/cafes')
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
          {permissions['cafes.verify'] && (
            <button onClick={toggleVerified} className="flex min-h-10 items-center gap-1.5 rounded-[var(--radius)] border border-border-strong px-3.5 text-[13px] font-medium text-foreground hover:bg-surface-subtle">
              {data.account.verified ? <ShieldOff size={14} /> : <ShieldCheck size={14} />}
              {data.account.verified ? 'Remove verification' : 'Verify café'}
            </button>
          )}
          {permissions['cafes.edit'] && (
            <button onClick={resetPassword} disabled={resettingPw || !data.business.owner_email} className="flex min-h-10 items-center gap-1.5 rounded-[var(--radius)] border border-border-strong px-3.5 text-[13px] font-medium text-foreground hover:bg-surface-subtle disabled:opacity-40">
              <Key size={14} /> {resettingPw ? 'Sending…' : 'Reset owner password'}
            </button>
          )}
        </div>

        {permissions['cafes.suspend'] && (
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
        )}

        {(permissions['plans.change'] || permissions['subscriptions.manage']) && (
          <div className="mt-4 space-y-3 border-t border-border pt-4">
            {permissions['plans.change'] && (
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-[13px] text-muted-foreground">Change / renew plan:</label>
                <select
                  value={planKey}
                  onChange={(e) => setPlanKey(e.target.value)}
                  className="h-9 rounded-[var(--radius-sm)] border border-border-strong bg-surface px-2 text-[13px] text-foreground"
                >
                  {plans.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.name} — {p.price_yearly ? `₹${p.price_yearly}/yr` : `₹${p.price_monthly}/mo`}
                    </option>
                  ))}
                </select>
                <label className="ml-2 text-[13px] text-muted-foreground">effective</label>
                <input
                  type="date"
                  value={effectiveDate}
                  onChange={(e) => setEffectiveDate(e.target.value)}
                  className="h-9 rounded-[var(--radius-sm)] border border-border-strong bg-surface px-2 text-[13px] text-foreground"
                />
                <button
                  onClick={applyPlan}
                  disabled={applyingPlan}
                  className="h-9 rounded-[var(--radius-sm)] bg-primary px-3 text-[12.5px] font-medium text-primary-foreground disabled:opacity-40"
                >
                  {applyingPlan ? 'Applying…' : 'Apply'}
                </button>
                <p className="w-full text-[11.5px] text-muted-foreground">
                  Suspension date is calculated automatically from the effective date — 14 days for Trial, 365 days for annual plans, 30 days otherwise. Renews a café already suspended for expiry.
                </p>
              </div>
            )}
            {permissions['subscriptions.manage'] && (
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-[13px] text-muted-foreground">Manually override subscription end date:</label>
                <input type="date" value={subEndsAt} onChange={(e) => setSubEndsAt(e.target.value)} className="h-9 rounded-[var(--radius-sm)] border border-border-strong bg-surface px-2 text-[13px] text-foreground" />
                <button onClick={extendSubscription} className="h-9 rounded-[var(--radius-sm)] border border-border-strong bg-surface-subtle px-3 text-[12.5px] font-medium text-foreground hover:bg-surface">Save override</button>
              </div>
            )}
          </div>
        )}
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

      {/* Always included — informational, not gated on anything */}
      <section className="mt-6 rounded-xl border border-border bg-surface p-5">
        <p className="text-sm font-medium text-foreground">Always included</p>
        <p className="mt-1 text-[12.5px] text-muted-foreground">Every café gets these regardless of plan — nothing to toggle.</p>
        <ul className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
          {ALWAYS_INCLUDED.map((label) => (
            <li key={label} className="text-[13px] text-muted-foreground">{label}</li>
          ))}
        </ul>
      </section>

      {/* Feature control */}
      <section className="mt-6 rounded-xl border border-border bg-surface p-5">
        <p className="text-sm font-medium text-foreground">Feature control</p>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          <b>Plan</b> shows what the café&apos;s <span className="capitalize">{data.account.plan}</span> plan includes by default, read-only.{' '}
          <b>Manual</b> lets you override any of it for this café only, regardless of plan.
        </p>

        <div className="mt-3 flex gap-1 border-b border-border">
          {(['plan', 'manual'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFeatureTab(t)}
              className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-medium capitalize ${
                featureTab === t ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {featureTab === 'plan' ? (
          <div className="mt-4 space-y-5">
            {FEATURE_GROUPS.map((g) => (
              <div key={g.heading}>
                <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">{g.heading}</p>
                <ul className="mt-2 divide-y divide-border">
                  {g.keys.map((key) => {
                    const f = FEATURES.find((x) => x.key === key)!
                    const included = data.features.plan_defaults[key] ?? false
                    return (
                      <li key={key} className="flex items-center justify-between py-2 text-[13.5px]">
                        <span className="text-foreground">{f.label}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${included ? 'bg-success-subtle text-success' : 'bg-surface-subtle text-muted-foreground'}`}>
                          {included ? 'Included' : 'Not included'}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4">
            {permissions['cafes.edit'] && (
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => void setAllFeatures(true)}
                  disabled={bulkSetting}
                  className="rounded-full border border-border-strong px-3 py-1.5 text-[12.5px] font-medium text-foreground hover:bg-surface-subtle disabled:opacity-40"
                >
                  Turn all on
                </button>
                <button
                  onClick={() => void setAllFeatures(false)}
                  disabled={bulkSetting}
                  className="rounded-full border border-border-strong px-3 py-1.5 text-[12.5px] font-medium text-foreground hover:bg-surface-subtle disabled:opacity-40"
                >
                  Turn all off
                </button>
              </div>
            )}
            <div className="mt-3 space-y-5">
              {FEATURE_GROUPS.map((g) => (
                <div key={g.heading}>
                  <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">{g.heading}</p>
                  <ul className="mt-2 divide-y divide-border">
                    {g.keys.map((key) => {
                      const f = FEATURES.find((x) => x.key === key)!
                      const override = overrideByKey.has(key) ? overrideByKey.get(key)! : null
                      const effective = override ?? data.features.plan_defaults[key] ?? false
                      return (
                        <li key={key} className="flex items-center justify-between py-2.5 text-[13.5px]">
                          <div>
                            <span className="text-foreground">{f.label}</span>
                            {override !== null && <span className="ml-2 text-[11px] text-warning">override</span>}
                          </div>
                          <div className="flex items-center gap-2">
                            {override !== null && permissions['cafes.edit'] && (
                              <button onClick={() => clearOverride(key)} disabled={bulkSetting} className="text-[11.5px] text-muted-foreground hover:underline disabled:opacity-40">Reset</button>
                            )}
                            <button
                              onClick={() => toggleFeature(key, override)}
                              disabled={!permissions['cafes.edit'] || bulkSetting}
                              className={`h-6 w-11 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${effective ? 'bg-primary' : 'bg-surface-subtle'}`}
                            >
                              <span className={`block h-5 w-5 rounded-full bg-white shadow transition-transform ${effective ? 'translate-x-5' : 'translate-x-0.5'}`} />
                            </button>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Operator notes */}
      <section className="mt-6 rounded-xl border border-border bg-surface p-5">
        <p className="flex items-center gap-1.5 text-sm font-medium text-foreground"><StickyNote size={14} /> Operator notes</p>
        <p className="mt-1 text-[12px] text-muted-foreground">Private — never visible to the café.</p>
        {permissions['cafes.edit'] && (
          <div className="mt-3 flex gap-2">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note…" className="h-10 flex-1 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[13.5px] text-foreground placeholder:text-muted-foreground" />
            <button onClick={addNote} disabled={addingNote || !note.trim()} className="h-10 rounded-[var(--radius)] bg-primary px-4 text-[13px] font-medium text-primary-foreground disabled:opacity-40">Add</button>
          </div>
        )}
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

      {/* Danger zone — permanent deletion, distinct from the reversible
          status actions above (Suspend/Disable/Archive). */}
      {permissions['cafes.delete'] && (
        <section className="mt-6 rounded-xl border border-destructive/30 bg-destructive-subtle/40 p-5">
          <p className="text-sm font-medium text-destructive">Danger zone</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Permanently deletes this café and everything tied to it. Not reversible — for a café that should just
            stop operating, use Archive above instead.
          </p>
          <button
            onClick={() => setDeleting(true)}
            className="mt-3 min-h-10 rounded-[var(--radius)] border border-destructive px-3.5 text-[13px] font-medium text-destructive hover:bg-destructive-subtle"
          >
            Delete this café permanently
          </button>
        </section>
      )}

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

      {deleting && (
        <DeleteCafeDialog
          cafeName={data.business.name}
          usage={{
            staff_count: data.usage.staff_count,
            orders_count: data.usage.orders_count,
            customers_count: data.usage.customers_count,
            menu_items_count: data.usage.menu_items_count,
          }}
          submitting={deleteSubmitting}
          error={deleteError}
          onClose={() => { setDeleting(false); setDeleteError(null) }}
          onConfirm={confirmDelete}
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
