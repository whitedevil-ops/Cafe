'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ShieldCheck, ShieldOff, ArrowLeft, Key, StickyNote, Search, Users, CreditCard,
  Activity, Settings, LayoutGrid, AlertTriangle, Copy, Building2,
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { ReasonDialog } from '@/components/operator/reason-dialog'
import { DeleteCafeDialog } from '@/components/ops/delete-cafe-dialog'
import { OpenCafeDashboard } from '@/components/ops/open-cafe-dashboard'
import { Badge, type StripTone } from '@/components/ops/ui'
import { formatDate, formatDateTime } from '@/lib/datetime'

export type HealthRow = {
  cafe_id: string
  name: string
  status: string
  days_since_last_order: number | null
  onboarding_percent: number
  failed_sms_count: number
  days_until_expiry: number | null
  /** Desktop app version last reported by this café's print bridge, and when
   *  it last checked in.
   *
   *  These two answer DIFFERENT questions and must not be conflated.
   *  `bridge_last_seen_at` is the only evidence of whether printing has ever
   *  worked. `app_version` is null for any café still on a build older than
   *  v1.2.1, because reporting it is what that release added — so a perfectly
   *  healthy café that checked in a minute ago has no version, and reading a
   *  missing version as "never connected" reported two live cafés as dead. */
  app_version: string | null
  bridge_last_seen_at: string | null
}

export type StaffRow = {
  user_id: string
  full_name: string | null
  email: string | null
  phone: string | null
  role: string
  status: string
  joined_at: string
  last_sign_in_at: string | null
  last_seen_at: string | null
  last_device: string | null
}

export type SessionRow = {
  id: string
  admin_name: string | null
  admin_email: string | null
  reason: string
  started_at: string
  expires_at: string
  ended_at: string | null
}

export type CafeDetail = {
  business: {
    id: string; name: string; logo_url: string | null; owner_name: string | null; owner_email: string | null
    owner_phone: string | null; phone: string | null; address: string | null; city: string | null
    state: string | null; pincode: string | null; gstin: string | null; created_at: string
  }
  account: {
    status: string; status_reason: string | null; status_changed_at: string | null; verified: boolean
    verified_at: string | null; plan: string; trial_ends_at: string | null; subscription_ends_at: string | null
    billing_status: string; razorpay_subscription_id: string | null
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
// callers, plus public_cafe_ordering_enabled for qr_ordering) — deliberately
// excludes keys platform_plans.features still carries but nothing reads
// (kds, multi_staff — see ALWAYS_INCLUDED/max_staff instead), and excludes
// 'referral' — the Refer & Earn UI was removed from every customer/owner
// surface (loyalty settings, customer wallet, login gate), so a toggle here
// would control a feature nobody can see or use. Recipes, Purchases,
// Suppliers, Profitability, and Recommendations are NOT listed separately —
// each is real, but none has its own entitlement key (the first four ride on
// 'inventory' or 'advanced_reports', Recommendations has no plan gate at
// all, only a role check) — see each feature's own description below for
// exactly what it bundles, rather than inventing a toggle that would
// silently do nothing. Spin & Win used to be in that list; migration 0204
// gave it a real 'spin' key of its own, enforced end to end (save_spin_wheel,
// get_spin_wheel, spin_the_wheel), so its toggle below genuinely works.
const FEATURES: { key: string; label: string; description: string }[] = [
  { key: 'qr_ordering', label: 'QR Ordering', description: 'Kill switch for the customer-facing QR menu & ordering flow.' },
  { key: 'crm', label: 'Customer Directory (CRM)', description: 'Saved customer profiles and order history.' },
  { key: 'feedback', label: 'Customer Feedback', description: 'Post-order rating & feedback collection.' },
  { key: 'coupons', label: 'Coupons', description: 'Discount codes at checkout.' },
  { key: 'loyalty', label: 'Loyalty & Rewards', description: 'Points on payment and redeemable rewards. Spin & Win is separate — see below.' },
  { key: 'spin', label: 'Spin & Win', description: 'The prize wheel guests spin on their receipt after paying. Off-plan, guests simply see no wheel; prize codes already issued stay redeemable.' },
  { key: 'wallet', label: 'Customer Wallet', description: 'Stored-value wallet with online top-ups.' },
  { key: 'reservations', label: 'Table Reservations', description: 'Guest-facing table booking.' },
  { key: 'sms_bills', label: 'SMS Bill Receipts', description: 'Text the digital bill link after payment.' },
  { key: 'whatsapp_bills', label: 'WhatsApp Bill Receipts', description: 'WhatsApp the digital bill link after payment.' },
  { key: 'inventory', label: 'Inventory, Recipes & Purchases', description: 'Stock tracking, recipe costing, and supplier purchase orders.' },
  { key: 'expenses', label: 'Expenses Tracking', description: 'Manual expense entries feeding the Profitability report.' },
  { key: 'advanced_analytics', label: 'Advanced Analytics', description: 'The /dashboard/analytics deep-dive page.' },
  { key: 'advanced_reports', label: 'Advanced Reports', description: 'GST invoice register and refund/adjustment reports beyond a single day.' },
  { key: 'online_payments', label: 'Online Payments (Razorpay)', description: 'Customer UPI/card payment at checkout, via this café\'s own Razorpay account.' },
]

const FEATURE_GROUPS: { heading: string; keys: string[] }[] = [
  { heading: 'Operations', keys: ['qr_ordering'] },
  { heading: 'Customer & Growth', keys: ['crm', 'feedback', 'coupons', 'loyalty', 'spin', 'wallet', 'reservations', 'sms_bills', 'whatsapp_bills'] },
  { heading: 'Inventory & Operations', keys: ['inventory', 'expenses'] },
  { heading: 'Analytics & Reporting', keys: ['advanced_analytics', 'advanced_reports'] },
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
  'Sales report, Day Close, Item sales, Payments & aging, Operations', 'Recommendations (role-gated, not plan-gated)',
  'Owner Command Center',
]

const STATUS_ACTIONS: { to: string; label: string; destructive: boolean; explain: string }[] = [
  { to: 'active', label: 'Activate', destructive: false, explain: 'Restores full staff and QR-ordering access immediately.' },
  {
    to: 'suspended', label: 'Suspend', destructive: true,
    explain: 'Blocks staff and QR-ordering access immediately. Data is fully preserved — reversible with Activate.',
  },
  {
    to: 'disabled', label: 'Disable', destructive: true,
    explain: 'Blocks staff and QR-ordering access immediately. Data is fully preserved — functionally identical to Suspend today; the two exist as separate states for your own record-keeping, not because the backend treats them differently.',
  },
  {
    to: 'archived', label: 'Archive', destructive: true,
    explain: 'Blocks staff and QR-ordering access immediately. Data is fully preserved (nothing is deleted) — functionally identical to Suspend/Disable today. Use this to mark a café as no longer operating, distinct from Delete below.',
  },
]

const TABS = [
  { key: 'overview', label: 'Overview', icon: LayoutGrid },
  { key: 'account', label: 'Account & Subscription', icon: CreditCard },
  { key: 'features', label: 'Features', icon: Settings },
  { key: 'staff', label: 'Users & Staff', icon: Users },
  { key: 'usage', label: 'Usage', icon: Building2 },
  { key: 'payments', label: 'Payments', icon: CreditCard },
  { key: 'health', label: 'Health', icon: Activity },
  { key: 'activity', label: 'Activity', icon: Activity },
  { key: 'settings', label: 'Settings', icon: StickyNote },
  { key: 'danger', label: 'Danger Zone', icon: AlertTriangle },
] as const
type TabKey = (typeof TABS)[number]['key']

const fmt = (iso: string | null) => formatDate(iso)
const fmtDateTime = (iso: string) => formatDateTime(iso)

// Priority order mirrors the tones /ops/health already assigns its four
// buckets (destructive > warning > info), plus one addition: an already-
// expired subscription (days_until_expiry < 0), a state the raw signal can
// represent but /ops/health's own >= 0 filter ignores.
function getHealthVerdict(h: HealthRow): { label: 'Healthy' | 'Needs Attention' | 'Critical'; tone: StripTone; reason: string } {
  if (h.failed_sms_count > 0) {
    return { label: 'Critical', tone: 'destructive', reason: `${h.failed_sms_count} SMS ${h.failed_sms_count === 1 ? 'delivery has' : 'deliveries have'} failed` }
  }
  if (h.days_until_expiry !== null && h.days_until_expiry < 0) {
    const days = Math.abs(h.days_until_expiry)
    return { label: 'Critical', tone: 'destructive', reason: `Subscription expired ${days} day${days === 1 ? '' : 's'} ago` }
  }
  if (h.status === 'active' && (h.days_since_last_order === null || h.days_since_last_order >= 7)) {
    return { label: 'Needs Attention', tone: 'warning', reason: h.days_since_last_order === null ? 'No orders placed yet' : `No orders in ${h.days_since_last_order} days` }
  }
  if (h.days_until_expiry !== null && h.days_until_expiry <= 30) {
    return { label: 'Needs Attention', tone: 'warning', reason: h.days_until_expiry === 0 ? 'Subscription expires today' : `Subscription expires in ${h.days_until_expiry} day${h.days_until_expiry === 1 ? '' : 's'}` }
  }
  if (h.onboarding_percent < 100) {
    return { label: 'Needs Attention', tone: 'warning', reason: `Onboarding ${h.onboarding_percent}% complete` }
  }
  return { label: 'Healthy', tone: 'success', reason: 'No active health signals' }
}

const BILLING_STATUS_LABEL: Record<string, string> = {
  none: 'No billing', created: 'Checkout started', active: 'Active', past_due: 'Payment issue', cancelled: 'Cancelled',
}
const BILLING_STATUS_TONE: Record<string, StripTone> = {
  none: 'neutral', created: 'info', active: 'success', past_due: 'warning', cancelled: 'destructive',
}

function planPrice(plans: { key: string; price_monthly: number; price_yearly: number | null }[], planKey: string): string {
  const p = plans.find((x) => x.key === planKey)
  if (!p) return '—'
  if (p.price_yearly) return `₹${p.price_yearly.toLocaleString('en-IN')}/yr`
  if (p.price_monthly) return `₹${p.price_monthly.toLocaleString('en-IN')}/mo`
  return 'Free'
}

// Duration math on two absolute timestamptz instants -- no café-local
// timezone conversion needed (that machinery exists to bucket events into
// café-local CALENDAR days; a duration between two instants is timezone-
// invariant). Matches op_cafe_health's own days_until_expiry precedent.
function daysRemainingLabel(iso: string | null): string {
  if (!iso) return '—'
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'Expired'
  return `${Math.ceil(ms / 86_400_000)}d left`
}

// Checked against subscription_ends_at, NOT trial_ends_at — see the
// original comment history in git blame for why (trial_ends_at freezes at
// signup; subscription_ends_at is what op_change_plan/op_extend_subscription
// actually move, and what dashboard/layout.tsx actually gates access on).
function trialExtendedHint(trialEndsAt: string | null, subscriptionEndsAt: string | null): string | undefined {
  if (!trialEndsAt || !subscriptionEndsAt) return undefined
  const now = Date.now()
  const trialOver = new Date(trialEndsAt).getTime() < now
  const stillActive = new Date(subscriptionEndsAt).getTime() > now
  return trialOver && stillActive ? 'Original offer — extended, see Subscription ends' : undefined
}

function sessionStatus(s: SessionRow): { label: string; tone: StripTone } {
  if (s.ended_at !== null) return { label: 'Ended', tone: 'neutral' }
  return new Date(s.expires_at).getTime() > Date.now()
    ? { label: 'Active', tone: 'success' }
    : { label: 'Expired', tone: 'warning' }
}

function trialStatus(plan: string, subscriptionEndsAt: string | null): { label: string; tone: StripTone } {
  if (plan !== 'trial') return { label: 'Converted', tone: 'success' }
  if (!subscriptionEndsAt) return { label: 'No trial', tone: 'neutral' }
  return new Date(subscriptionEndsAt).getTime() > Date.now()
    ? { label: 'Trialing', tone: 'info' }
    : { label: 'Trial expired', tone: 'warning' }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

export default function CafeDetailClient({
  cafeId,
  detail,
  plans,
  permissions,
  health,
  initialStaff,
  initialSessions,
}: {
  cafeId: string
  detail: CafeDetail
  plans: { key: string; name: string; price_monthly: number; price_yearly: number | null; max_staff: number | null }[]
  permissions: Record<string, boolean>
  health: HealthRow | null
  initialStaff: StaffRow[]
  initialSessions: SessionRow[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const { toast } = useToast()
  const confirm = useConfirm()
  // Captured once at mount rather than read during render: Date.now() in JSX
  // is impure and this repo's lint rejects it (the café-facing bridge indicator
  // keeps its clock in state for the same reason). Freshness only needs to be
  // right when the page is opened — ops reloads to re-check.
  const [renderedAt] = useState(() => Date.now())
  const [data, setData] = useState(detail)
  const [tab, setTab] = useState<TabKey>('overview')
  const [statusDialog, setStatusDialog] = useState<{ to: string; label: string; destructive: boolean } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [addingNote, setAddingNote] = useState(false)
  const [subEndsAt, setSubEndsAt] = useState(data.account.subscription_ends_at?.slice(0, 10) ?? '')
  const [planKey, setPlanKey] = useState(data.account.plan)
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10))
  const [applyingPlan, setApplyingPlan] = useState(false)
  const [resettingPw, setResettingPw] = useState<string | null>(null)
  const [bulkSetting, setBulkSetting] = useState(false)
  const [featureTab, setFeatureTab] = useState<'plan' | 'manual'>('plan')
  const [featureSearch, setFeatureSearch] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [staff, setStaff] = useState(initialStaff)
  const [sessions] = useState(initialSessions)
  const [staffBusy, setStaffBusy] = useState<string | null>(null)

  async function refresh() {
    const { data: fresh } = await supabase.rpc('op_get_cafe_detail', { p_cafe_id: cafeId })
    if (fresh) setData(fresh as CafeDetail)
  }
  async function refreshStaff() {
    const { data: fresh } = await supabase.rpc('op_list_cafe_staff', { p_cafe_id: cafeId })
    if (fresh) setStaff(fresh as StaffRow[])
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
    const planName = plans.find((p) => p.key === planKey)?.name ?? planKey
    const currentName = plans.find((p) => p.key === data.account.plan)?.name ?? data.account.plan
    const ok = await confirm({
      title: `Change plan: ${currentName} → ${planName}?`,
      description: `Effective ${fmt(new Date(effectiveDate).toISOString())}. The new subscription end date is calculated automatically (14 days for Trial, 365 for an annual plan, 30 otherwise), and this reactivates the café if it's currently suspended for expiry.`,
      confirmLabel: 'Change plan',
    })
    if (!ok) return
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
    const ok = await confirm({
      title: 'Override subscription end date?',
      description: `Manually sets the subscription end date to ${fmt(new Date(subEndsAt).toISOString())}, bypassing the plan's normal billing cycle. Use only when the automatic calculation is wrong.`,
      confirmLabel: 'Save override',
    })
    if (!ok) return
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

  async function resetPassword(userId: string | null, email: string | null) {
    const ok = await confirm({
      title: 'Reset password?',
      description: `Sends a secure password-reset link to ${email}. No password is ever shown or stored.`,
      confirmLabel: 'Send reset link',
    })
    if (!ok) return
    setResettingPw(userId ?? 'owner')
    const res = await fetch('/api/ops/reset-owner-password', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cafe_id: cafeId, target_user_id: userId ?? undefined }),
    })
    setResettingPw(null)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return toast(body.error ?? 'Could not send reset link.', 'error')
    toast(`Reset link sent to ${body.email}.`)
  }

  async function toggleStaffStatus(row: StaffRow) {
    const next = row.status === 'active' ? 'suspended' : 'active'
    const ok = await confirm({
      title: next === 'suspended' ? `Disable ${row.full_name ?? 'this person'}?` : `Re-enable ${row.full_name ?? 'this person'}?`,
      description: next === 'suspended'
        ? 'They immediately lose access to this café\'s dashboard and POS. Reversible any time.'
        : 'Restores their access to this café\'s dashboard and POS immediately.',
      confirmLabel: next === 'suspended' ? 'Disable' : 'Re-enable',
      destructive: next === 'suspended',
    })
    if (!ok) return
    setStaffBusy(row.user_id)
    const { error } = await supabase.rpc('op_set_staff_status', { p_cafe_id: cafeId, p_user_id: row.user_id, p_status: next })
    setStaffBusy(null)
    if (error) return toast(error.message, 'error')
    toast(next === 'suspended' ? 'Staff member disabled.' : 'Staff member re-enabled.')
    void refreshStaff()
  }

  async function confirmDelete() {
    setDeleteSubmitting(true)
    setDeleteError(null)
    const { error } = await supabase.rpc('op_delete_cafe', { p_cafe_id: cafeId, p_confirm_name: data.business.name })
    setDeleteSubmitting(false)
    if (error) return setDeleteError(error.message)
    toast(`${data.business.name} permanently deleted.`)
    router.push('/ops/cafes')
  }

  async function copyId() {
    try {
      await navigator.clipboard.writeText(data.business.id)
      toast('Café ID copied.')
    } catch {
      // Clipboard API can be unavailable — the id is still visible to copy manually.
    }
  }

  const overrideByKey = new Map(data.features.overrides.map((o) => [o.feature_key, o.enabled]))
  const onboardingFlags = data.onboarding
    ? ([
        ['Account created', data.onboarding.account_created],
        ['Café profile completed', data.onboarding.profile_completed],
        ['Menu added', data.onboarding.menu_added],
        ['Tables created', data.onboarding.tables_created],
        ['QR generated', data.onboarding.qr_generated],
        ['Staff added', data.onboarding.staff_added],
        ['First order placed', data.onboarding.first_order_placed],
      ] as const)
    : []
  const onboardingPct = onboardingFlags.length
    ? Math.round((onboardingFlags.filter(([, v]) => v).length / onboardingFlags.length) * 100)
    : 0
  const healthVerdict = health ? getHealthVerdict(health) : null
  const maxStaff = plans.find((p) => p.key === data.account.plan)?.max_staff ?? null
  const filteredFeatures = featureSearch.trim()
    ? FEATURES.filter((f) => f.label.toLowerCase().includes(featureSearch.trim().toLowerCase()))
    : null

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <Link href="/ops/cafes" className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft size={14} /> All cafés
      </Link>

      {/* ── Header card ─────────────────────────────────────────────────── */}
      <div className="mt-3 rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3.5">
            {data.business.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.business.logo_url} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" />
            ) : (
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-primary-subtle text-[15px] font-semibold text-primary">
                {initials(data.business.name)}
              </div>
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">{data.business.name}</h1>
                {data.account.verified && (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-primary-subtle px-2 py-0.5 text-[11.5px] font-medium text-primary">
                    <ShieldCheck size={12} /> Verified
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-[11.5px] font-medium capitalize text-foreground">{data.account.status}</span>
                <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-[11.5px] font-medium capitalize text-foreground">{data.account.plan}</span>
                {healthVerdict && <Badge tone={healthVerdict.tone}>{healthVerdict.label}</Badge>}
                <button onClick={copyId} className="flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground">
                  <Copy size={11} /> {data.business.id.slice(0, 8)}
                </button>
              </div>
              <p className="mt-1.5 text-[12.5px] text-muted-foreground">
                {data.business.owner_name ?? '—'} · {data.business.owner_email ?? '—'}
                {data.business.city && <> · {data.business.city}</>}
                {' · Sub. ends '}{fmt(data.account.subscription_ends_at)}
              </p>
            </div>
          </div>
        </div>

        {data.account.status_reason && <p className="mt-3 text-[13px] text-muted-foreground">Reason: {data.account.status_reason}</p>}
        {healthVerdict && <p className="mt-1 text-[13px] text-muted-foreground">Health: {healthVerdict.reason}</p>}

        {/* Quick actions */}
        <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
          {permissions['cafes.impersonate'] && <OpenCafeDashboard cafeId={cafeId} cafeName={data.business.name} />}
          {permissions['cafes.verify'] && (
            <button onClick={toggleVerified} className="flex min-h-9 items-center gap-1.5 rounded-[var(--radius)] border border-border-strong px-3 text-[12.5px] font-medium text-foreground hover:bg-surface-subtle">
              {data.account.verified ? <ShieldOff size={13} /> : <ShieldCheck size={13} />}
              {data.account.verified ? 'Remove verification' : 'Verify café'}
            </button>
          )}
          {permissions['cafes.reset_password'] && (
            <button onClick={() => resetPassword(null, data.business.owner_email)} disabled={resettingPw !== null || !data.business.owner_email} className="flex min-h-9 items-center gap-1.5 rounded-[var(--radius)] border border-border-strong px-3 text-[12.5px] font-medium text-foreground hover:bg-surface-subtle disabled:opacity-40">
              <Key size={13} /> {resettingPw === 'owner' ? 'Sending…' : 'Reset owner password'}
            </button>
          )}
          {permissions['plans.change'] && (
            <button onClick={() => setTab('account')} className="flex min-h-9 items-center gap-1.5 rounded-[var(--radius)] border border-border-strong px-3 text-[12.5px] font-medium text-foreground hover:bg-surface-subtle">
              <CreditCard size={13} /> Change plan
            </button>
          )}
          {permissions['cafes.suspend'] && (
            <button onClick={() => setTab('danger')} className="flex min-h-9 items-center gap-1.5 rounded-[var(--radius)] border border-destructive/40 px-3 text-[12.5px] font-medium text-destructive hover:bg-destructive-subtle">
              <AlertTriangle size={13} /> Suspend / Disable / Archive
            </button>
          )}
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 -mx-6 mt-5 overflow-x-auto bg-background px-6 py-1">
        <div className="flex gap-1 border-b border-border">
          {TABS.map((t) => {
            if (t.key === 'health' && !permissions['health.view']) return null
            if (t.key === 'danger' && !permissions['cafes.suspend'] && !permissions['cafes.delete']) return null
            const Icon = t.icon
            const active = tab === t.key
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] font-medium whitespace-nowrap ${
                  active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                } ${t.key === 'danger' ? (active ? '!text-destructive !border-destructive' : 'hover:!text-destructive') : ''}`}
              >
                <Icon size={14} /> {t.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-5">
        {tab === 'overview' && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <Metric label="Plan" value={<span className="capitalize">{data.account.plan}</span>} />
            <Metric label="Subscription" value={(() => { const t = trialStatus(data.account.plan, data.account.subscription_ends_at); return <Badge tone={t.tone}>{t.label}</Badge> })()} />
            <Metric label="Subscription ends" value={fmt(data.account.subscription_ends_at)} sub={daysRemainingLabel(data.account.subscription_ends_at)} />
            <Metric label="Verification" value={data.account.verified ? <Badge tone="success">Verified</Badge> : <Badge tone="neutral">Not verified</Badge>} />
            <Metric label="Café status" value={<span className="capitalize">{data.account.status}</span>} />
            <Metric label="Owner" value={data.business.owner_name ?? '—'} sub={data.business.owner_email ?? undefined} />
            <Metric label="Registered" value={fmt(data.business.created_at)} />
            <Metric label="Last order" value={data.usage.last_order_at ? fmtDateTime(data.usage.last_order_at) : 'None yet'} />
            <Metric label="Staff" value={maxStaff ? `${data.usage.staff_count} / ${maxStaff}` : data.usage.staff_count} />
            <Metric label="Menu items" value={data.usage.menu_items_count} />
            <Metric label="Tables" value={data.usage.tables_count} />
            <Metric label="Customers" value={data.usage.customers_count} />
            <Metric label="Orders" value={data.usage.orders_count} />
            {data.onboarding && (
              <div className="col-span-2 rounded-xl border border-border bg-surface p-4 sm:col-span-3 lg:col-span-4">
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-medium text-foreground">Onboarding</p>
                  <span className="text-[13px] font-semibold text-foreground">{onboardingPct}%</span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-subtle">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${onboardingPct}%` }} />
                </div>
                <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
                  {onboardingFlags.map(([label, done]) => (
                    <li key={label} className="flex items-center gap-1.5 text-[12.5px]">
                      <span className={done ? 'text-primary' : 'text-muted-foreground'}>{done ? '✓' : '○'}</span>
                      <span className={done ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {tab === 'account' && (
          <div className="space-y-5">
            <section className="rounded-xl border border-border bg-surface p-5">
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

            <section className="rounded-xl border border-border bg-surface p-5">
              <p className="text-sm font-medium text-foreground">Account &amp; subscription</p>
              <div className="mt-3 grid grid-cols-2 gap-3 text-[13.5px] sm:grid-cols-3">
                <Field label="Plan" value={data.account.plan} capitalize />
                <Field label="Plan price" value={planPrice(plans, data.account.plan)} />
                <Field label="Billing period" value="Monthly (via Razorpay)" hint="price_yearly is a reference figure only — subscriptions bill monthly." />
                <Field
                  label="Trial ends"
                  value={fmt(data.account.trial_ends_at)}
                  hint={trialExtendedHint(data.account.trial_ends_at, data.account.subscription_ends_at)}
                />
                <Field label="Subscription ends" value={fmt(data.account.subscription_ends_at)} />
                <Field label="Days remaining" value={daysRemainingLabel(data.account.subscription_ends_at)} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {(() => { const t = trialStatus(data.account.plan, data.account.subscription_ends_at); return <Badge tone={t.tone}>{t.label}</Badge> })()}
                <Badge tone={BILLING_STATUS_TONE[data.account.billing_status] ?? 'neutral'}>{BILLING_STATUS_LABEL[data.account.billing_status] ?? data.account.billing_status}</Badge>
              </div>

              {(permissions['plans.change'] || permissions['subscriptions.manage']) && (
                <div className="mt-4 space-y-4 border-t border-border pt-4">
                  {permissions['plans.change'] && (
                    <div>
                      <p className="text-[13px] font-medium text-foreground">Change / renew plan</p>
                      <p className="mt-1 flex items-center gap-2 text-[13px] text-muted-foreground">
                        <span className="capitalize">{data.account.plan}</span>
                        <span aria-hidden>→</span>
                        <span className="font-medium capitalize text-foreground">{planKey}</span>
                        {planKey !== data.account.plan && <span className="text-[11.5px]">(changing)</span>}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <select value={planKey} onChange={(e) => setPlanKey(e.target.value)} className="h-9 rounded-[var(--radius-sm)] border border-border-strong bg-surface px-2 text-[13px] text-foreground">
                          {plans.map((p) => (
                            <option key={p.key} value={p.key}>{p.name} — {p.price_yearly ? `₹${p.price_yearly}/yr` : `₹${p.price_monthly}/mo`}</option>
                          ))}
                        </select>
                        <label className="text-[13px] text-muted-foreground">effective</label>
                        <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className="h-9 rounded-[var(--radius-sm)] border border-border-strong bg-surface px-2 text-[13px] text-foreground" />
                        <button onClick={applyPlan} disabled={applyingPlan} className="h-9 rounded-[var(--radius-sm)] bg-primary px-3 text-[12.5px] font-medium text-primary-foreground disabled:opacity-40">
                          {applyingPlan ? 'Applying…' : 'Apply'}
                        </button>
                      </div>
                      <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                        Subscription end date is calculated automatically from the effective date — 14 days for Trial, 365 for annual plans, 30 otherwise. Renews a café already suspended for expiry.
                      </p>
                    </div>
                  )}
                  {permissions['subscriptions.manage'] && (
                    <div className="border-t border-border pt-4">
                      <p className="text-[13px] font-medium text-foreground">Manually override subscription end date</p>
                      <p className="mt-1 text-[11.5px] text-muted-foreground">For fixing a wrong automatic calculation — bypasses the plan&apos;s normal billing cycle entirely.</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <input type="date" value={subEndsAt} onChange={(e) => setSubEndsAt(e.target.value)} className="h-9 rounded-[var(--radius-sm)] border border-border-strong bg-surface px-2 text-[13px] text-foreground" />
                        <button onClick={extendSubscription} className="h-9 rounded-[var(--radius-sm)] border border-border-strong bg-surface-subtle px-3 text-[12.5px] font-medium text-foreground hover:bg-surface">Save override</button>
                      </div>
                      <p className="mt-2 text-[11.5px] text-muted-foreground">
                        There is no separate &quot;pause billing&quot; action distinct from café status — billing_status above is set automatically by the Razorpay webhook, not directly editable here. Suspend/Activate on the Danger Zone tab is what actually gates access.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        )}

        {tab === 'features' && (
          <section className="rounded-xl border border-border bg-surface p-5">
            <p className="text-sm font-medium text-foreground">Feature control</p>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              <b>Plan</b> shows what the café&apos;s <span className="capitalize">{data.account.plan}</span> plan includes by default, read-only.{' '}
              <b>Manual</b> lets you override any of it for this café only, regardless of plan.
            </p>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-1 border-b border-border">
                {(['plan', 'manual'] as const).map((t) => (
                  <button key={t} onClick={() => setFeatureTab(t)} className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-medium capitalize ${featureTab === t ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
                    {t}
                  </button>
                ))}
              </div>
              <div className="relative">
                <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={featureSearch}
                  onChange={(e) => setFeatureSearch(e.target.value)}
                  placeholder="Search features…"
                  className="h-8 w-48 rounded-[var(--radius)] border border-border-strong bg-surface pl-7 pr-2 text-[12.5px] text-foreground placeholder:text-muted-foreground"
                />
              </div>
            </div>

            {featureTab === 'plan' ? (
              <div className="mt-4 space-y-5">
                {FEATURE_GROUPS.map((g) => {
                  const keys = g.keys.filter((k) => !filteredFeatures || filteredFeatures.some((f) => f.key === k))
                  if (keys.length === 0) return null
                  return (
                    <div key={g.heading}>
                      <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">{g.heading}</p>
                      <ul className="mt-2 divide-y divide-border">
                        {keys.map((key) => {
                          const f = FEATURES.find((x) => x.key === key)!
                          const included = data.features.plan_defaults[key] ?? false
                          const override = overrideByKey.has(key) ? overrideByKey.get(key)! : null
                          const effective = override ?? included
                          return (
                            <li key={key} className="flex items-center justify-between gap-3 py-2.5 text-[13.5px]">
                              <div className="min-w-0">
                                <p className="text-foreground">{f.label}</p>
                                <p className="truncate text-[11.5px] text-muted-foreground">{f.description}</p>
                              </div>
                              <div className="flex shrink-0 items-center gap-1.5">
                                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${included ? 'bg-success-subtle text-success' : 'bg-surface-subtle text-muted-foreground'}`}>
                                  Plan: {included ? 'Included' : 'Not included'}
                                </span>
                                {/* This café has a manual override on this feature — the plan
                                    badge above is what the PLAN provides, not what the café can
                                    actually use right now. Without this, an admin skimming only
                                    the Plan tab could see "Included" for a feature an override
                                    has actually turned off (or the reverse), with no indication
                                    a second, decisive setting exists on the Manual tab. */}
                                {override !== null && (
                                  <button
                                    type="button"
                                    onClick={() => setFeatureTab('manual')}
                                    title="A manual override changes this café's actual access — see the Manual tab"
                                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium underline decoration-dotted underline-offset-2 ${effective ? 'bg-primary-subtle text-primary' : 'bg-warning-subtle text-warning'}`}
                                  >
                                    Overridden — Effective {effective ? 'ON' : 'OFF'}
                                  </button>
                                )}
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="mt-4">
                {permissions['cafes.edit'] && (
                  <div className="flex justify-end gap-2">
                    <button onClick={() => void setAllFeatures(true)} disabled={bulkSetting} className="rounded-full border border-border-strong px-3 py-1.5 text-[12.5px] font-medium text-foreground hover:bg-surface-subtle disabled:opacity-40">Turn all on</button>
                    <button onClick={() => void setAllFeatures(false)} disabled={bulkSetting} className="rounded-full border border-border-strong px-3 py-1.5 text-[12.5px] font-medium text-foreground hover:bg-surface-subtle disabled:opacity-40">Turn all off</button>
                  </div>
                )}
                <div className="mt-3 space-y-5">
                  {FEATURE_GROUPS.map((g) => {
                    const keys = g.keys.filter((k) => !filteredFeatures || filteredFeatures.some((f) => f.key === k))
                    if (keys.length === 0) return null
                    return (
                      <div key={g.heading}>
                        <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">{g.heading}</p>
                        <ul className="mt-2 divide-y divide-border">
                          {keys.map((key) => {
                            const f = FEATURES.find((x) => x.key === key)!
                            const included = data.features.plan_defaults[key] ?? false
                            const override = overrideByKey.has(key) ? overrideByKey.get(key)! : null
                            const effective = override ?? included
                            return (
                              <li key={key} className="flex items-center justify-between gap-3 py-2.5 text-[13.5px]">
                                <div className="min-w-0">
                                  <p className="text-foreground">{f.label}</p>
                                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                                    <span className={`rounded-full px-1.5 py-0.5 font-medium ${included ? 'bg-success-subtle text-success' : 'bg-surface-subtle text-muted-foreground'}`}>Plan: {included ? 'Included' : 'Not included'}</span>
                                    {override !== null && (
                                      <span className={`rounded-full px-1.5 py-0.5 font-medium ${override ? 'bg-primary-subtle text-primary' : 'bg-warning-subtle text-warning'}`}>Override {override ? 'ON' : 'OFF'}</span>
                                    )}
                                    <span className={`rounded-full px-1.5 py-0.5 font-medium ${effective ? 'bg-success-subtle text-success' : 'bg-surface-subtle text-muted-foreground'}`}>Effective: {effective ? 'ON' : 'OFF'}</span>
                                  </p>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
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
                    )
                  })}
                </div>
              </div>
            )}

            <div className="mt-6 border-t border-border pt-4">
              <p className="text-[13px] font-medium text-foreground">Always included</p>
              <p className="mt-1 text-[12.5px] text-muted-foreground">Every café gets these regardless of plan — nothing to toggle.</p>
              <ul className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
                {ALWAYS_INCLUDED.map((label) => <li key={label} className="text-[13px] text-muted-foreground">{label}</li>)}
              </ul>
            </div>
          </section>
        )}

        {tab === 'staff' && (
          <section className="rounded-xl border border-border bg-surface p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-foreground">Users &amp; staff</p>
              {maxStaff && <p className="text-[12.5px] text-muted-foreground">{staff.filter((s) => s.status === 'active').length} / {maxStaff} seats used</p>}
            </div>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Reset password and Disable/Re-enable are real actions below. Adding staff, changing a role, or removing someone isn&apos;t available from the console yet — those still need to be done by the café&apos;s own owner.
            </p>
            {staff.length === 0 ? (
              <p className="mt-4 text-[13px] text-muted-foreground">No staff on record.</p>
            ) : (
              <ul className="mt-4 space-y-2.5">
                {staff.map((s) => (
                  <li key={s.user_id} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-border p-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-[13.5px] font-medium text-foreground">{s.full_name ?? '—'}</p>
                        <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-[11px] font-medium capitalize text-foreground">{s.role}</span>
                        <Badge tone={s.status === 'active' ? 'success' : s.status === 'invited' ? 'info' : 'warning'}>{s.status}</Badge>
                      </div>
                      <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                        {s.email ?? '—'} · Joined {fmt(s.joined_at)} · Last active {s.last_seen_at ? fmtDateTime(s.last_seen_at) : '—'}{s.last_device ? ` · ${s.last_device}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {permissions['cafes.reset_password'] && s.email && (
                        <button onClick={() => resetPassword(s.user_id, s.email)} disabled={resettingPw !== null} className="flex h-8 items-center gap-1 rounded-[var(--radius-sm)] border border-border-strong px-2.5 text-[12px] font-medium text-foreground hover:bg-surface-subtle disabled:opacity-40">
                          <Key size={12} /> {resettingPw === s.user_id ? 'Sending…' : 'Reset password'}
                        </button>
                      )}
                      {permissions['cafes.edit'] && s.status !== 'invited' && (
                        <button
                          onClick={() => toggleStaffStatus(s)}
                          disabled={staffBusy !== null}
                          className={`h-8 rounded-[var(--radius-sm)] border px-2.5 text-[12px] font-medium disabled:opacity-40 ${s.status === 'active' ? 'border-destructive/40 text-destructive hover:bg-destructive-subtle' : 'border-border-strong text-foreground hover:bg-surface-subtle'}`}
                        >
                          {staffBusy === s.user_id ? '…' : s.status === 'active' ? 'Disable' : 'Re-enable'}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === 'usage' && (
          <section className="rounded-xl border border-border bg-surface p-5">
            <p className="text-sm font-medium text-foreground">Usage vs. plan limits</p>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <UsageBar label="Staff" value={data.usage.staff_count} limit={maxStaff} />
              <UsageBar label="Menu items" value={data.usage.menu_items_count} limit={null} />
              <UsageBar label="Tables" value={data.usage.tables_count} limit={null} />
              <UsageBar label="Customers" value={data.usage.customers_count} limit={null} />
              <UsageBar label="Orders (all-time)" value={data.usage.orders_count} limit={null} />
            </div>
            <p className="mt-4 text-[12px] text-muted-foreground">
              Only staff seats have a real plan limit (max_staff). Menu items, tables, customers, and orders have no
              cap on any plan today — shown as counts, not a limit an operator needs to watch.
            </p>
          </section>
        )}

        {tab === 'payments' && (
          <section className="rounded-xl border border-border bg-surface p-5">
            <p className="text-sm font-medium text-foreground">Payments &amp; billing</p>
            <div className="mt-3 grid grid-cols-2 gap-3 text-[13.5px] sm:grid-cols-3">
              <Field label="Plan" value={data.account.plan} capitalize />
              <Field label="Plan price" value={planPrice(plans, data.account.plan)} />
              <Field label="Subscription start" value={fmt(data.business.created_at)} hint="No separate billing-start date is stored — the café's own created_at is the closest real signal." />
              <Field label="Subscription ends" value={fmt(data.account.subscription_ends_at)} />
              <Field label="Razorpay subscription" value={data.account.razorpay_subscription_id ? 'Linked' : 'Not linked'} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge tone={BILLING_STATUS_TONE[data.account.billing_status] ?? 'neutral'}>{BILLING_STATUS_LABEL[data.account.billing_status] ?? data.account.billing_status}</Badge>
              {data.account.billing_status === 'past_due' && <span className="text-[12.5px] text-warning">Last payment attempt failed — see billing_status.</span>}
            </div>
            <p className="mt-4 text-[12px] text-muted-foreground">
              billing_status is set automatically by the Razorpay webhook (created/active/past_due/cancelled) — it is
              not directly editable here. No secrets or card/UPI details are ever stored or shown; this console only
              ever sees the subscription lifecycle state.
            </p>
          </section>
        )}

        {tab === 'health' && permissions['health.view'] && (
          <section className="rounded-xl border border-border bg-surface p-5">
            <p className="text-sm font-medium text-foreground">Café health</p>
            {health ? (
              <>
                <div className="mt-3 flex items-center gap-2">
                  {healthVerdict && <Badge tone={healthVerdict.tone}>{healthVerdict.label}</Badge>}
                  <p className="text-[13px] text-muted-foreground">{healthVerdict?.reason}</p>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Metric label="Last order" value={health.days_since_last_order === null ? 'Never' : `${health.days_since_last_order}d ago`} />
                  <Metric label="Onboarding" value={`${health.onboarding_percent}%`} />
                  <Metric label="Failed SMS" value={health.failed_sms_count} />
                  <Metric label="Subscription" value={health.days_until_expiry === null ? '—' : health.days_until_expiry < 0 ? 'Expired' : `${health.days_until_expiry}d left`} />
                </div>
                {/* Which desktop build this café is actually running, reported
                    by its own print bridge. Worth its own row rather than a
                    fifth metric: "never connected" is a different kind of fact
                    from the counters above — it means auto-printing has never
                    once worked here, which stayed invisible for a full day in
                    the 2026-09-01 incident and was true of two cafés for far
                    longer than that. */}
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-border px-3 py-2.5">
                  <span className="text-[11.5px] uppercase tracking-wide text-muted-foreground">Desktop app</span>
                  {health.bridge_last_seen_at ? (
                    <>
                      {/* Freshness uses the same 2-minute window as the café's
                          own header indicator and printer_health(), so ops and
                          the café never disagree about the same bridge. */}
                      <Badge tone={renderedAt - new Date(health.bridge_last_seen_at).getTime() < 120000 ? 'success' : 'warning'}>
                        {renderedAt - new Date(health.bridge_last_seen_at).getTime() < 120000 ? 'Connected' : 'Not printing now'}
                      </Badge>
                      {/* Absent on anything older than v1.2.1, which is what
                          added version reporting — so "unknown" here means an
                          older build, never a broken one. */}
                      <Badge tone="neutral">{health.app_version ? `v${health.app_version}` : 'version unknown'}</Badge>
                      <span className="text-[12.5px] text-muted-foreground">
                        last checked in {fmtDateTime(health.bridge_last_seen_at)}
                      </span>
                    </>
                  ) : (
                    <>
                      <Badge tone="warning">Never connected</Badge>
                      <span className="text-[12.5px] text-muted-foreground">
                        No print bridge has ever checked in — automatic KOT printing has never worked for this café.
                      </span>
                    </>
                  )}
                </div>
              </>
            ) : (
              <p className="mt-3 text-[13px] text-muted-foreground">No health data available.</p>
            )}
            <div className="mt-5 border-t border-border pt-4">
              <p className="text-[13px] font-medium text-foreground">Per-system status</p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Honest about what&apos;s actually measured: only the four signals above have a real backend source today.
                Nothing below has live telemetry — shown as &quot;Not configured&quot; rather than a fabricated Online/Offline
                reading.
              </p>
              <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {['QR Ordering uptime', 'POS uptime', 'KDS uptime', 'Printer connectivity', 'Online payment gateway', 'Notification delivery (WhatsApp)'].map((label) => (
                  <li key={label} className="flex items-center justify-between rounded-[var(--radius)] border border-border px-3 py-2 text-[13px]">
                    <span className="text-foreground">{label}</span>
                    <Badge tone="neutral">Not configured</Badge>
                  </li>
                ))}
                <li className="flex items-center justify-between rounded-[var(--radius)] border border-border px-3 py-2 text-[13px]">
                  <span className="text-foreground">SMS delivery</span>
                  <Badge tone={health && health.failed_sms_count > 0 ? 'destructive' : 'success'}>{health && health.failed_sms_count > 0 ? `${health.failed_sms_count} failed` : 'No recent failures'}</Badge>
                </li>
              </ul>
            </div>
          </section>
        )}

        {tab === 'activity' && (
          <>
          <section className="rounded-xl border border-border bg-surface p-5">
            <p className="text-sm font-medium text-foreground">Session history</p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Every time a platform admin opened this café&apos;s own dashboard, with their stated reason — not the
              same as the actions log below, which is every action taken anywhere on the platform, not just inside a
              session here.
            </p>
            {sessions.length === 0 ? (
              <p className="mt-3 text-[13px] text-muted-foreground">No admin has opened this café&apos;s dashboard yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {sessions.map((s) => {
                  const { label, tone } = sessionStatus(s)
                  return (
                    <li key={s.id} className="rounded-[var(--radius)] border border-border p-3 text-[13px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-foreground">{s.admin_name ?? s.admin_email ?? 'Unknown admin'}</span>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge tone={tone}>{label}</Badge>
                          <span className="text-[11.5px] text-muted-foreground">{fmtDateTime(s.started_at)}</span>
                        </div>
                      </div>
                      <p className="mt-0.5 text-[11.5px] text-muted-foreground">{s.reason}</p>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
          <section className="mt-4 rounded-xl border border-border bg-surface p-5">
            <p className="text-sm font-medium text-foreground">Activity on this café</p>
            <p className="mt-1 text-[12px] text-muted-foreground">The most recent 20 operator actions. Immutable — this list only ever grows via real actions taken above, never edited from here.</p>
            {data.recent_audit.length === 0 ? (
              <p className="mt-3 text-[13px] text-muted-foreground">No operator actions logged yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {data.recent_audit.map((a, i) => (
                  <li key={i} className="rounded-[var(--radius)] border border-border p-3 text-[13px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-foreground">{a.action}</span>
                      <span className="shrink-0 text-[11.5px] text-muted-foreground">{fmtDateTime(a.created_at)}</span>
                    </div>
                    <p className="mt-0.5 text-[11.5px] text-muted-foreground">by {a.actor_name ?? 'operator'}</p>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/ops/audit-logs" className="mt-3 inline-block text-[12.5px] font-medium text-primary hover:underline">See the full platform audit log →</Link>
          </section>
          </>
        )}

        {tab === 'settings' && (
          <section className="rounded-xl border border-border bg-surface p-5">
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
        )}

        {tab === 'danger' && (
          <div className="space-y-5">
            {permissions['cafes.suspend'] && (
              <section className="rounded-xl border border-destructive/30 bg-destructive-subtle/40 p-5">
                <p className="text-sm font-medium text-destructive">Café status</p>
                <p className="mt-1 text-[12.5px] text-muted-foreground">Takes effect immediately for staff and QR ordering. All three below preserve every bit of data — nothing is deleted.</p>
                <ul className="mt-3 space-y-2">
                  {STATUS_ACTIONS.filter((a) => a.to !== data.account.status).map((a) => (
                    <li key={a.to} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-border bg-surface p-3">
                      <p className="text-[13px] text-muted-foreground">{a.explain}</p>
                      <button
                        onClick={() => { setDialogError(null); setStatusDialog(a) }}
                        className={`shrink-0 min-h-9 rounded-[var(--radius-sm)] border px-3 text-[12.5px] font-medium ${a.destructive ? 'border-destructive text-destructive hover:bg-destructive-subtle' : 'border-border-strong text-foreground hover:bg-surface-subtle'}`}
                      >
                        {a.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {permissions['cafes.delete'] && (
              <section className="rounded-xl border border-destructive/30 bg-destructive-subtle/40 p-5">
                <p className="text-sm font-medium text-destructive">Permanent deletion</p>
                <p className="mt-1 text-[12.5px] text-muted-foreground">
                  Permanently deletes this café and everything tied to it. Not reversible — for a café that should just stop operating, use Archive above instead.
                </p>
                <button onClick={() => setDeleting(true)} className="mt-3 min-h-10 rounded-[var(--radius)] border border-destructive px-3.5 text-[13px] font-medium text-destructive hover:bg-destructive-subtle">
                  Delete this café permanently
                </button>
              </section>
            )}
          </div>
        )}
      </div>

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

function Field({ label, value, capitalize, hint }: { label: string; value: string | null; capitalize?: boolean; hint?: string }) {
  return (
    <div>
      <p className="text-[11.5px] text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-foreground ${capitalize ? 'capitalize' : ''}`}>{value || '—'}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Metric({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3.5">
      <p className="text-[11.5px] text-muted-foreground">{label}</p>
      <div className="mt-1 text-[15px] font-semibold text-foreground">{value}</div>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  )
}

function UsageBar({ label, value, limit }: { label: string; value: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((value / limit) * 100)) : null
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-[12.5px] text-muted-foreground">{label}</p>
        <p className="text-[13.5px] font-semibold text-foreground">{limit ? `${value} / ${limit}` : value}</p>
      </div>
      {pct !== null && (
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-subtle">
          <div className={`h-full rounded-full ${pct >= 90 ? 'bg-destructive' : pct >= 70 ? 'bg-warning' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}
