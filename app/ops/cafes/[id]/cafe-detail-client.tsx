'use client'

import { useMemo, useState } from 'react'
import { copyText } from '@/lib/desktop-open'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ShieldCheck, ShieldOff, ArrowLeft, Key, StickyNote, Search, Users, CreditCard,
  Activity, Settings, LayoutGrid, AlertTriangle, Copy, Building2, Mail, Lock,
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { ReasonDialog } from '@/components/operator/reason-dialog'
import { DeleteCafeDialog } from '@/components/ops/delete-cafe-dialog'
import { OpenCafeDashboard } from '@/components/ops/open-cafe-dashboard'
import { InvoiceGenerateModal } from '@/components/ops/invoice-generate-modal'
import { Badge, Panel, type StripTone } from '@/components/ops/ui'
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

// An unsaved, staged feature-override edit — see pendingChanges below.
type PendingChange = { kind: 'set'; value: boolean } | { kind: 'clear' }

// Every key here is actually checked by app code (see lib/entitlements.ts
// callers, plus public_cafe_ordering_enabled for qr_ordering) — excludes
// 'referral', since the Refer & Earn UI was removed from every
// customer/owner surface (loyalty settings, customer wallet, login gate), so
// a toggle here would control a feature nobody can see or use. Spin & Win
// used to ride informally on 'loyalty'; migration 0204 gave it a real 'spin'
// key of its own, enforced end to end (save_spin_wheel, get_spin_wheel,
// spin_the_wheel), so its toggle below genuinely works.
const FEATURES: { key: string; label: string; description: string }[] = [
  { key: 'qr_ordering', label: 'QR Ordering', description: 'Kill switch for the customer-facing QR menu & ordering flow.' },
  { key: 'crm', label: 'Customer Directory (CRM)', description: 'Saved customer profiles and order history.' },
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
  { key: 'advanced_reports', label: 'Advanced Reports', description: 'GST invoice register, plus the Adjustments, Operations, Profitability and Recommendations report pages — everything beyond Core Reports’ single-day view.' },
  { key: 'online_payments', label: 'Online Payments (Razorpay)', description: 'Customer UPI/card payment at checkout, via this café\'s own Razorpay account.' },
  // ── Always-included, until now ungated (entitlement batches 0-5,
  // 2026-09-10) — every key below is seeded true on all five plans, so
  // turning one off is purely a per-café override, never a downgrade path.
  { key: 'kds', label: 'Kitchen Display System (KDS)', description: 'The live kitchen screen — both the staff dashboard page and the unattended guest-facing /kds board.' },
  { key: 'kot_printing', label: 'KOT / kitchen order tickets', description: 'The order ticket itself, printed or on-screen — automatic tickets on new orders and on later edits.' },
  { key: 'kot_reprint', label: 'Manual KOT reprint', description: 'Re-queuing a ticket for an order already ticketed once.' },
  { key: 'bluetooth_printer', label: 'Bluetooth printer', description: 'Direct Bluetooth printing from a phone or tablet, no desktop app needed.' },
  { key: 'desktop_printing', label: 'Direct desktop printing', description: 'The desktop app writing straight to the printer, skipping the print dialog.' },
  { key: 'kitchen_stations', label: 'Kitchen stations', description: 'Adding new prep stations and routing menu categories to them.' },
  { key: 'live_tables', label: 'Live Tables', description: 'Floor view and table status.' },
  { key: 'discounts', label: 'Discounts at billing', description: 'Applying a manual discount when placing or billing an order.' },
  { key: 'held_orders', label: 'Held orders', description: 'Parking an order at the till to resume later.' },
  { key: 'order_cancel', label: 'Cancel with reason', description: 'Cancelling an order and recording why.' },
  { key: 'digital_receipts', label: 'Digital receipts', description: 'The customer-facing bill link (/r/[token]) — also carries the embedded Spin widget, AutoPrint and the PDF button, so this is a whole-page kill switch.' },
  { key: 'split_payments', label: 'Split payments', description: 'Recording more than one payment method against a single bill.' },
  { key: 'refunds', label: 'Refunds', description: 'Issuing a refund against a completed order.' },
  { key: 'waiter_quick_add', label: 'Waiter tableside quick-add', description: 'Adding items to a table\'s order from the floor view.' },
  { key: 'customer_my_orders', label: 'Customer "My Orders"', description: 'Guest order history on their own device.' },
  { key: 'upsell_prompt', label: 'Upsell prompt during ordering', description: 'The live guest-facing suggestion shown while ordering — distinct from the Recommendations report under Advanced Reports.' },
  { key: 'core_reports', label: 'Core reports', description: 'Sales, Day Close, Item sales, Payments & aging — the single-day reports.' },
  { key: 'dine_in_ordering', label: 'Dine-in ordering', description: 'Guests and staff can place dine-in orders — the café\'s own dine-in switch in Settings must also be on.' },
  { key: 'takeaway_ordering', label: 'Takeaway ordering', description: 'Guests and staff can place takeaway orders — the café\'s own takeaway switch in Settings must also be on.' },
  { key: 'cash_management', label: 'Cash shift & drawer reconciliation', description: 'Opening a cash shift and reconciling the drawer — the café\'s own cash-management switch in Settings must also be on.' },
]

// Which paid plan first unlocks each toggle (live platform_plans.features
// composition — starter/pro/business, shown by their real product names).
// Shown inline per row now rather than as the primary grouping — see
// CATEGORIES below for why the grouping itself changed. If a feature's plan
// floor is ever repackaged, this hardcoded mapping needs updating to match,
// same as any other snapshot of pricing/packaging decisions in this file.
const PLAN_FLOOR: Record<string, string> = {
  qr_ordering: 'Starter', crm: 'Starter',
  coupons: 'Growth', loyalty: 'Growth', spin: 'Growth', wallet: 'Growth', reservations: 'Growth',
  sms_bills: 'Growth', whatsapp_bills: 'Growth', expenses: 'Growth', advanced_analytics: 'Growth', online_payments: 'Growth',
  inventory: 'Scale', advanced_reports: 'Scale',
}

// The only 3 plans a Feature Control operator should ever see or preview —
// 'trial' (the signup starting point) and the internal-only 'android' plan
// (Ops-assignable, never shown to a café owner or the public) are both
// active=true in platform_plans, so the `plans` prop passed to this
// component is NOT already limited to these 3 and must be filtered here.
const PLAN_SELECTOR_KEYS = ['starter', 'pro', 'business']

// Full-product audit (2026-09-10): grouped by what an operator is actually
// looking for ("what does this café's ordering flow look like") rather than
// by which plan unlocks it — the plan tier is still shown per row via
// PLAN_FLOOR, it's just no longer the thing the page is organised around.
// "Operations" was considered as its own top-level section (a real Ops
// Admin ask) but its contents — ordering, kitchen, billing — are exactly
// Ordering + Kitchen + Billing & Payments below; a separate bucket would
// only have duplicated rows already living in those three, so it was folded
// in instead of invented as a fourth home for the same content.
//
// planKeys is the Plans tab — differs by plan tier, PLAN_FLOOR caption.
// alwaysKeys is the Always Included tab — real switches too (entitlement
// batches 0-5), but every key is seeded true on all five plans, so the row
// caption reads "Included on every plan by default" instead of a plan name.
// `static` entries are the remainder: real, live capabilities with genuinely
// NO entitlement gate anywhere in the code, confirmed by direct grep for
// hasFeature/cafe_has_feature/cafe_feature_for_guest against every route,
// component and RPC that implements them, not assumed. They render
// read-only (no switch) for exactly that reason: a toggle here would
// control nothing. Six of them — Digital menu builder, POS billing, GST
// invoicing on the bill, Café profile & settings, Owner Command Center, Pay
// at counter + customer UPI — were deliberately EXCLUDED from gating (user
// decision, 2026-09-10): each has no safe recovery path if switched off, or
// duplicates an existing mechanism. They say so on their own row. The
// remaining static rows (print bridge pairing, "print now on this device",
// staff accounts & roles, per-role screen access) simply have no dedicated
// feature key at all, seeded or otherwise.
const CATEGORIES: { heading: string; planKeys: string[]; alwaysKeys: string[]; static: { label: string; description: string }[] }[] = [
  {
    heading: 'Ordering',
    planKeys: ['qr_ordering', 'reservations'],
    alwaysKeys: ['dine_in_ordering', 'takeaway_ordering', 'customer_my_orders'],
    static: [
      { label: 'Digital menu builder', description: 'One menu shared by the counter, QR ordering and the kitchen — kept permanently off-limits, not configurable.' },
    ],
  },
  {
    heading: 'Kitchen',
    planKeys: [],
    alwaysKeys: ['kds', 'kot_printing', 'kot_reprint', 'bluetooth_printer', 'desktop_printing', 'kitchen_stations'],
    static: [
      { label: 'Print bridge & automatic KOT printing', description: 'Pairing the desktop app’s background print bridge — no dedicated feature key.' },
      { label: 'Print now on this device', description: 'Browser-triggered printing from the kitchen screen — the permanent fallback path, deliberately left ungated.' },
    ],
  },
  {
    heading: 'Billing & Payments',
    planKeys: ['online_payments'],
    alwaysKeys: ['live_tables', 'discounts', 'held_orders', 'order_cancel', 'digital_receipts', 'split_payments', 'refunds', 'cash_management', 'waiter_quick_add'],
    static: [
      { label: 'POS billing', description: 'Core checkout/billing flow — kept permanently off-limits, not configurable.' },
      { label: 'GST invoicing on the bill', description: 'Distinct from the GST *report* (see Advanced Reports) — kept permanently off-limits, not configurable.' },
      { label: 'Pay at counter + customer UPI', description: 'Counter-side payment methods — kept permanently off-limits, not configurable.' },
    ],
  },
  {
    heading: 'Customers & Marketing',
    planKeys: ['crm', 'coupons', 'loyalty', 'spin', 'wallet', 'sms_bills', 'whatsapp_bills'],
    alwaysKeys: ['upsell_prompt'],
    static: [],
  },
  {
    heading: 'Management',
    planKeys: ['expenses'],
    alwaysKeys: [],
    static: [
      { label: 'Owner Command Center', description: 'The dashboard home itself — kept permanently off-limits, not configurable.' },
      { label: 'Café profile & settings', description: 'Business details, hours, and preferences — kept permanently off-limits, not configurable.' },
    ],
  },
  {
    heading: 'Inventory',
    planKeys: ['inventory'],
    alwaysKeys: [],
    static: [],
  },
  {
    heading: 'Reports & Analytics',
    planKeys: ['advanced_analytics', 'advanced_reports'],
    alwaysKeys: ['core_reports'],
    static: [],
  },
  {
    heading: 'Staff & Access',
    planKeys: [],
    alwaysKeys: [],
    static: [
      { label: 'Staff accounts & roles', description: 'Seat-capped by plan (platform_plans.max_staff — see Account & Subscription), not an on/off feature.' },
      { label: 'Per-role screen access control', description: 'Which dashboard screens each role can see, configurable per café.' },
    ],
  },
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

// cafes.plan stores the internal KEY ('pro', 'business') — every display
// spot below used to show that raw key (CSS-capitalized, so "Pro"/"Business")
// instead of the real product name ("Growth"/"Scale"), which is a different
// string entirely, not just a casing difference. platform_plans.name is
// already correctly cased — no capitalize class needed once this is used.
function planName(plans: { key: string; name: string }[], planKey: string): string {
  return plans.find((p) => p.key === planKey)?.name ?? planKey
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
  selfRole,
  health,
  initialStaff,
  initialSessions,
}: {
  cafeId: string
  detail: CafeDetail
  plans: {
    key: string
    name: string
    price_monthly: number
    price_yearly: number | null
    max_staff: number | null
    features: Record<string, boolean>
    max_owned_cafes: number
  }[]
  permissions: Record<string, boolean>
  selfRole: string
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
  // Individual feature switches stage a local change here instead of
  // writing immediately — Save (with its own confirmation) is what actually
  // calls op_set_feature_override/op_clear_feature_override. Keyed by
  // feature key so re-toggling the same row just replaces its pending entry.
  const [pendingChanges, setPendingChanges] = useState<Map<string, PendingChange>>(new Map())
  const [savingChanges, setSavingChanges] = useState(false)
  const [featureSearch, setFeatureSearch] = useState('')
  // Which half of Feature control is showing — independent of the page's
  // outer `tab` state. 'plans' is the existing plan-tiered toggle set;
  // 'always' is the ~20 items every plan includes by default, which now
  // carry real switches too (full-product audit, 2026-09-10).
  const [featureSubTab, setFeatureSubTab] = useState<'plans' | 'always'>('plans')
  // Which plan card is being previewed on the Plans sub-tab — null means "no
  // explicit click yet", which resolves to the café's own current plan at
  // render time (see activePreviewKey below) rather than being reset via an
  // effect whenever the café's real plan changes elsewhere on this page.
  const [previewPlanKey, setPreviewPlanKey] = useState<string | null>(null)
  // Collapsed category headings — empty means everything expanded, matching
  // the panel's behavior before this was collapsible at all.
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set())
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [staff, setStaff] = useState(initialStaff)
  const [sessions] = useState(initialSessions)
  const [staffBusy, setStaffBusy] = useState<string | null>(null)
  const [changingEmail, setChangingEmail] = useState<{ userId: string | null; name: string; email: string | null } | null>(null)

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
    const newPlanName = plans.find((p) => p.key === planKey)?.name ?? planKey
    const currentName = plans.find((p) => p.key === data.account.plan)?.name ?? data.account.plan
    const isActualSwitch = planKey !== data.account.plan
    const overrideCount = data.features.overrides.length
    const ok = await confirm({
      title: `Change plan: ${currentName} → ${newPlanName}?`,
      description: `Effective ${fmt(new Date(effectiveDate).toISOString())}. The new subscription end date is calculated automatically (14 days for Trial, 365 for an annual plan, 30 otherwise), and this reactivates the café if it's currently suspended for expiry.${
        isActualSwitch && overrideCount > 0
          ? ` This café has ${overrideCount} manual feature override${overrideCount === 1 ? '' : 's'} — switching plans clears ${overrideCount === 1 ? 'it' : 'them'} so every feature starts clean on ${newPlanName}'s defaults.`
          : ''
      }`,
      confirmLabel: 'Change plan',
    })
    if (!ok) return
    setApplyingPlan(true)
    const { data: newEndsAt, error } = await supabase.rpc('op_change_plan', {
      p_cafe_id: cafeId, p_plan_key: planKey, p_effective_date: new Date(effectiveDate).toISOString(),
    })
    setApplyingPlan(false)
    if (error) return toast(error.message, 'error')
    toast(`Plan set to ${newPlanName} — active until ${fmt(newEndsAt as string)}.`)
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

  // Clicking a switch or "reset to plan default" no longer writes
  // anything — it only stages a local, unsaved change. Nothing reaches
  // op_set_feature_override/op_clear_feature_override until the operator
  // reviews the pending list and explicitly clicks Save (with its own
  // confirmation) — found live: a stray click on this page previously
  // flipped a feature off for a real café with zero confirmation.
  //
  // 'set' stages a specific on/off value; 'clear' stages reverting to plan
  // default. Keyed by feature key, so staging a second change to the same
  // key simply replaces the first.
  function stageToggle(key: string, displayOverride: boolean | null, included: boolean) {
    const next = !(displayOverride ?? included)
    setPendingChanges((m) => {
      const copy = new Map(m)
      copy.set(key, { kind: 'set', value: next })
      return copy
    })
  }

  // "Reset to plan default" on a key with a real, already-saved override
  // stages a clear (applied on Save). On a key whose only override exists
  // as a pending, unsaved stage, there's nothing saved to clear — this just
  // un-stages it, with no RPC involved at all.
  function stageClear(key: string, hasRealOverride: boolean) {
    setPendingChanges((m) => {
      const copy = new Map(m)
      if (hasRealOverride) copy.set(key, { kind: 'clear' })
      else copy.delete(key)
      return copy
    })
  }

  function discardChanges() {
    setPendingChanges(new Map())
  }

  async function saveChanges() {
    const entries = [...pendingChanges.entries()]
    if (entries.length === 0) return
    const ok = await confirm({
      title: `Save ${entries.length} feature change${entries.length === 1 ? '' : 's'}?`,
      description: 'Applies these overrides for this café only, immediately — its subscription plan is unaffected.',
      confirmLabel: 'Save changes',
    })
    if (!ok) return
    setSavingChanges(true)
    const results = await Promise.all(
      entries.map(([key, change]) =>
        change.kind === 'clear'
          ? supabase.rpc('op_clear_feature_override', { p_cafe_id: cafeId, p_feature_key: key })
          : supabase.rpc('op_set_feature_override', { p_cafe_id: cafeId, p_feature_key: key, p_enabled: change.value }),
      ),
    )
    setSavingChanges(false)
    // refresh() re-reads real server state regardless of outcome below, so a
    // failed change simply snaps its row back to whatever it actually is —
    // same "never show a wrong toggle" guarantee setAllFeatures already had.
    const failures = entries.map(([key], i) => ({ key, error: results[i].error })).filter((r) => r.error)
    setPendingChanges(new Map())
    void refresh()
    if (failures.length === 0) {
      toast(`${entries.length} feature change${entries.length === 1 ? '' : 's'} saved.`)
    } else if (failures.length === entries.length) {
      toast(failures[0].error!.message, 'error')
    } else {
      toast(`${entries.length - failures.length}/${entries.length} saved — failed: ${failures.map((f) => f.key).join(', ')}`, 'error')
    }
  }

  async function setAllFeatures(enabled: boolean) {
    // Scoped to whichever sub-tab is showing — bulk-toggling the Plans tab
    // must never silently also flip refunds/order_cancel/etc. on the Always
    // Included tab, and vice versa.
    const keys = CATEGORIES.flatMap((c) => (featureSubTab === 'plans' ? c.planKeys : c.alwaysKeys))
    const ok = await confirm({
      title: enabled ? 'Turn on every feature on this tab?' : 'Turn off every feature on this tab?',
      description: enabled
        ? `Sets an explicit override to ON for all ${keys.length} features on this tab, for this café only.`
        : `Sets an explicit override to OFF for all ${keys.length} features on this tab, for this café only — this can take away things the café is actively using.`,
      confirmLabel: enabled ? 'Turn all on' : 'Turn all off',
    })
    if (!ok) return
    setBulkSetting(true)
    const results = await Promise.all(
      keys.map((key) => supabase.rpc('op_set_feature_override', { p_cafe_id: cafeId, p_feature_key: key, p_enabled: enabled })),
    )
    setBulkSetting(false)
    // FOUND (full-product audit, 2026-09-10): this used to report only the
    // first failed RPC's message even though many run in parallel — a
    // partial failure read identically to "one thing went wrong", with no
    // way to tell which features actually changed. refresh() below still
    // re-reads real server state regardless, so a partial failure never
    // shows a wrong toggle — it just wasn't ever reported as partial before.
    const failures = keys.map((key, i) => ({ key, error: results[i].error })).filter((r) => r.error)
    void refresh()
    if (failures.length === 0) {
      toast(enabled ? 'All features on this tab turned on.' : 'All features on this tab turned off.')
    } else if (failures.length === keys.length) {
      toast(failures[0].error!.message, 'error')
    } else {
      toast(`${keys.length - failures.length}/${keys.length} updated — failed: ${failures.map((f) => f.key).join(', ')}`, 'error')
    }
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
    const ok = await copyText(data.business.id)
    toast(ok ? 'Café ID copied.' : 'Could not copy — the ID is on screen, copy it manually.', ok ? 'success' : 'error')
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
  const featureSearchTerm = featureSearch.trim().toLowerCase()
  // Matches the feature's own label/description, or the heading of any
  // category it belongs to — a category lookup per feature (34 features ×
  // 8 categories) is trivial at this size, no memoization needed.
  const filteredFeatures = featureSearchTerm
    ? FEATURES.filter((f) =>
        f.label.toLowerCase().includes(featureSearchTerm) ||
        f.description.toLowerCase().includes(featureSearchTerm) ||
        CATEGORIES.some((c) => (c.planKeys.includes(f.key) || c.alwaysKeys.includes(f.key)) && c.heading.toLowerCase().includes(featureSearchTerm)),
      )
    : null

  // Plan-tab derivation — see PLAN_SELECTOR_KEYS/previewPlanKey above. null
  // previewPlanKey resolves to the café's own current plan here rather than
  // in an effect, so a plan change elsewhere (Account tab + refresh())
  // self-corrects with no extra wiring. This only decides which plan's
  // defaults the "Plan default" column shows — every row stays live and
  // editable regardless of which tab is selected.
  const selectablePlans = plans.filter((p) => PLAN_SELECTOR_KEYS.includes(p.key))
  const activePreviewKey = previewPlanKey ?? data.account.plan
  const previewPlan = selectablePlans.find((p) => p.key === activePreviewKey) ?? null

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
                <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-[11.5px] font-medium text-foreground">{planName(plans, data.account.plan)}</span>
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
          {selfRole === 'super_admin' && (
            <button onClick={() => setChangingEmail({ userId: null, name: data.business.owner_name ?? 'the owner', email: data.business.owner_email })} className="flex min-h-9 items-center gap-1.5 rounded-[var(--radius)] border border-border-strong px-3 text-[12.5px] font-medium text-foreground hover:bg-surface-subtle">
              <Mail size={13} /> Change owner email
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
            <Metric label="Plan" value={planName(plans, data.account.plan)} />
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
                <Field label="Plan" value={planName(plans, data.account.plan)} />
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
                        <span>{planName(plans, data.account.plan)}</span>
                        <span aria-hidden>→</span>
                        <span className="font-medium text-foreground">{planName(plans, planKey)}</span>
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
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">Feature control</p>
                <p className="mt-1 text-[12.5px] text-muted-foreground">
                  {featureSubTab === 'plans' ? (
                    <>Grant or remove any feature for this café only — its subscription plan itself is never changed by anything below.</>
                  ) : (
                    <>Included on every plan by default. Toggle anything below to turn it off for this café only — everything else keeps working as normal.</>
                  )}
                </p>
              </div>
              <div className="relative">
                <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={featureSearch}
                  onChange={(e) => setFeatureSearch(e.target.value)}
                  placeholder="Search name, description, category…"
                  className="h-8 w-56 rounded-[var(--radius)] border border-border-strong bg-surface pl-7 pr-2 text-[12.5px] text-foreground placeholder:text-muted-foreground"
                />
              </div>
            </div>

            {/* ── Plans / Always Included ─────────────────────────────────
                Same visual idiom as the outer tab strip. Plans varies by plan
                tier (PLAN_FLOOR); Always Included is everything every plan
                carries by default — a real switch where batches 0-5 gave it
                one, a locked badge where none exists. */}
            <div className="mt-4 flex gap-1 border-b border-border">
              {([
                { key: 'plans', label: 'Plans' },
                { key: 'always', label: 'Always Included' },
              ] as const).map((t) => (
                <button
                  key={t.key}
                  onClick={() => setFeatureSubTab(t.key)}
                  className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-medium ${
                    featureSubTab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* ── Plan tabs ────────────────────────────────────────────────
                Only on the Plans sub-tab — Always Included rows are true on
                every plan by construction, so there's no plan to select.
                Selecting a plan changes ONLY the "Plan default" column below
                (what that plan normally includes) — every row stays fully
                editable regardless of which tab is showing, and Effective /
                Manual override always reflect this café's real, current
                state. Granting a Growth feature to a Starter café from the
                Starter tab is exactly the intended use — it sets a per-café
                override, never the café's actual subscription. */}
            {featureSubTab === 'plans' && (
              <div className="mt-4">
                <div className="flex gap-1 border-b border-border">
                  {selectablePlans.map((p) => {
                    const isCurrent = p.key === data.account.plan
                    const isSelected = p.key === activePreviewKey
                    return (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => setPreviewPlanKey(p.key === data.account.plan ? null : p.key)}
                        className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium ${
                          isSelected ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {p.name}
                        {isCurrent && <span className="rounded-full bg-primary-subtle px-1.5 py-0.5 text-[10px] font-medium text-primary">Current</span>}
                      </button>
                    )
                  })}
                </div>
                {previewPlan && (
                  <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-[var(--radius)] bg-surface-subtle px-3.5 py-2.5 text-[12.5px]">
                    <span className="font-semibold text-foreground">{previewPlan.name}</span>
                    <span className="text-muted-foreground">{planPrice(plans, previewPlan.key)}</span>
                    <span className="text-muted-foreground">{previewPlan.max_owned_cafes} café{previewPlan.max_owned_cafes === 1 ? '' : 's'}</span>
                    <span className="text-muted-foreground">{previewPlan.max_staff ?? 'Unlimited'} staff seat{previewPlan.max_staff === 1 ? '' : 's'}</span>
                  </div>
                )}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                <button onClick={() => setCollapsedCats(new Set())} className="rounded-full border border-border-strong px-3 py-1.5 text-[12.5px] font-medium text-foreground hover:bg-surface-subtle">Expand all</button>
                <button onClick={() => setCollapsedCats(new Set(CATEGORIES.map((c) => c.heading)))} className="rounded-full border border-border-strong px-3 py-1.5 text-[12.5px] font-medium text-foreground hover:bg-surface-subtle">Collapse all</button>
              </div>
              {permissions['cafes.edit'] && (
                <div className="flex gap-2">
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
            </div>

            {/* Nothing below is written anywhere until this bar's Save is
                clicked and confirmed — every switch above only stages a
                local change. Appears only once something is actually
                staged, so it never clutters the page with an empty bar. */}
            {pendingChanges.size > 0 && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-warning bg-warning-subtle px-3.5 py-2.5">
                <p className="text-[12.5px] font-medium text-warning">
                  {pendingChanges.size} unsaved change{pendingChanges.size === 1 ? '' : 's'} — nothing has been applied yet.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={discardChanges}
                    disabled={savingChanges}
                    className="rounded-full border border-border-strong bg-surface px-3 py-1.5 text-[12.5px] font-medium text-foreground hover:bg-surface-subtle disabled:opacity-40"
                  >
                    Discard
                  </button>
                  <button
                    onClick={() => void saveChanges()}
                    disabled={savingChanges}
                    className="rounded-full bg-primary px-4 py-1.5 text-[12.5px] font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
                  >
                    {savingChanges ? 'Saving…' : `Save ${pendingChanges.size} change${pendingChanges.size === 1 ? '' : 's'}`}
                  </button>
                </div>
              </div>
            )}

            {/* One collapsible Panel per functional category — covers every
                real capability KhaoPiyo has, not just the plan-gated subset:
                a toggle row where a real entitlement exists, a locked row
                where it genuinely doesn't. The same 8 category headings
                appear on both tabs; a category with nothing on the active
                tab — in toggles, static rows, or matching the current
                search — disappears entirely rather than showing an empty
                card. */}
            <div className="mt-4 space-y-4">
              {CATEGORIES.map((cat) => {
                const activeKeys = featureSubTab === 'plans' ? cat.planKeys : cat.alwaysKeys
                const toggleKeys = activeKeys.filter((k) => !filteredFeatures || filteredFeatures.some((f) => f.key === k))
                // Static (genuinely ungated) rows are part of the Always
                // Included story, not the Plans one — they don't vary by
                // plan either, they just never got a real switch.
                const staticItems = featureSubTab !== 'always' ? [] : featureSearchTerm
                  ? cat.static.filter((s) => s.label.toLowerCase().includes(featureSearchTerm) || s.description.toLowerCase().includes(featureSearchTerm) || cat.heading.toLowerCase().includes(featureSearchTerm))
                  : cat.static
                const rowCount = toggleKeys.length + staticItems.length
                if (rowCount === 0) return null
                return (
                  <Panel
                    key={cat.heading}
                    title={cat.heading}
                    count={rowCount}
                    tone="neutral"
                    collapsible
                    open={!collapsedCats.has(cat.heading)}
                    onToggle={() =>
                      setCollapsedCats((s) => {
                        const next = new Set(s)
                        if (next.has(cat.heading)) next.delete(cat.heading)
                        else next.add(cat.heading)
                        return next
                      })
                    }
                  >
                    <ul className="divide-y divide-border">
                      {toggleKeys.map((key) => {
                        const f = FEATURES.find((x) => x.key === key)!
                        const included = data.features.plan_defaults[key] ?? false
                        const override = overrideByKey.has(key) ? overrideByKey.get(key)! : null
                        // The real, saved state (what a page reload would
                        // show) vs. what's staged-but-unsaved right now —
                        // the switch and every caption below react to the
                        // pending value the instant it's clicked, but
                        // nothing is written until Save.
                        const pending = pendingChanges.get(key)
                        const displayOverride = pending ? (pending.kind === 'clear' ? null : pending.value) : override
                        const effective = displayOverride ?? included
                        const isPending = pending !== undefined

                        const overrideNote = displayOverride !== null && (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {isPending ? (
                              <span className="font-medium text-warning">Unsaved change — not applied yet</span>
                            ) : (
                              'Manual override for this café'
                            )}
                            {permissions['cafes.edit'] && (
                              <>
                                {' — '}
                                <button
                                  type="button"
                                  onClick={() => stageClear(key, override !== null)}
                                  disabled={savingChanges}
                                  className="text-primary underline decoration-dotted underline-offset-2 hover:no-underline disabled:opacity-40"
                                >
                                  {isPending ? 'undo' : 'reset to plan default'}
                                </button>
                              </>
                            )}
                          </p>
                        )

                        // ── Plans sub-tab: the 3-field status layout. Every
                        // row is always live and editable no matter which
                        // plan tab is showing — only "Plan default" changes
                        // with the tab (falls back to the café's own real
                        // default when the selected plan doesn't carry the
                        // key at all, e.g. an unlisted trial/android plan).
                        // Effective and Manual override are never
                        // tab-relative — they're this café's real (or
                        // staged-to-become-real) state. ──
                        if (featureSubTab === 'plans') {
                          const planDefaultIncluded = previewPlan?.features?.[key] ?? included
                          return (
                            <li key={key} className="flex flex-col gap-3 py-3 text-[13.5px] sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0 sm:max-w-[38%]">
                                <p className="text-foreground">{f.label}</p>
                                <p className="mt-0.5 text-[12px] text-muted-foreground">{f.description}</p>
                                {overrideNote}
                              </div>
                              <div className="flex flex-wrap items-start gap-x-6 gap-y-2.5">
                                <StatusField label="Plan default">
                                  <Badge tone={planDefaultIncluded ? 'success' : 'neutral'}>{planDefaultIncluded ? 'Included' : 'Not included'}</Badge>
                                  <span className="mt-1 block text-[10.5px] text-muted-foreground">{previewPlan?.name ?? PLAN_FLOOR[key]}</span>
                                </StatusField>
                                <StatusField label="Effective">
                                  <Badge tone={effective ? 'success' : 'neutral'}>{effective ? 'On' : 'Off'}</Badge>
                                </StatusField>
                                <StatusField label="Manual override">
                                  <button
                                    onClick={() => stageToggle(key, displayOverride, included)}
                                    disabled={!permissions['cafes.edit'] || savingChanges}
                                    aria-label={`Turn ${f.label} ${effective ? 'off' : 'on'}`}
                                    className={`h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${effective ? 'bg-primary' : 'bg-surface-subtle'} ${isPending ? 'ring-2 ring-warning ring-offset-2 ring-offset-surface' : ''}`}
                                  >
                                    <span className={`block h-5 w-5 rounded-full bg-white shadow transition-transform ${effective ? 'translate-x-5' : 'translate-x-0.5'}`} />
                                  </button>
                                </StatusField>
                              </div>
                            </li>
                          )
                        }

                        // ── Always Included sub-tab: every key here is true
                        // on every plan by construction — no plan to preview,
                        // so this keeps the simpler single-status layout. ──
                        return (
                          <li key={key} className="flex items-center justify-between gap-4 py-3 text-[13.5px]">
                            <div className="min-w-0">
                              <p className="text-foreground">{f.label}</p>
                              <p className="mt-0.5 text-[12px] text-muted-foreground">{f.description}</p>
                              {displayOverride === null && (
                                <p className="mt-1 text-[11px] text-muted-foreground">
                                  Included on every plan by default{included ? '' : ' (not currently included here)'}
                                </p>
                              )}
                              {overrideNote}
                            </div>
                            <div className="flex shrink-0 items-center gap-2.5">
                              <span className={`text-[12px] font-medium ${effective ? 'text-success' : 'text-muted-foreground'}`}>{effective ? 'On' : 'Off'}</span>
                              <button
                                onClick={() => stageToggle(key, displayOverride, included)}
                                disabled={!permissions['cafes.edit'] || savingChanges}
                                aria-label={`Turn ${f.label} ${effective ? 'off' : 'on'}`}
                                className={`h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${effective ? 'bg-primary' : 'bg-surface-subtle'} ${isPending ? 'ring-2 ring-warning ring-offset-2 ring-offset-surface' : ''}`}
                              >
                                <span className={`block h-5 w-5 rounded-full bg-white shadow transition-transform ${effective ? 'translate-x-5' : 'translate-x-0.5'}`} />
                              </button>
                            </div>
                          </li>
                        )
                      })}
                      {staticItems.map((s) => (
                        <li key={s.label} className="flex items-center justify-between gap-4 py-3 text-[13.5px]">
                          <div className="min-w-0">
                            <p className="text-foreground">{s.label}</p>
                            <p className="mt-0.5 text-[12px] text-muted-foreground">{s.description}</p>
                          </div>
                          <span className="flex shrink-0 items-center gap-1 rounded-full bg-surface-subtle px-2 py-0.5 text-[11.5px] font-medium text-muted-foreground">
                            <Lock size={11} /> Locked
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Panel>
                )
              })}
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
                      {selfRole === 'super_admin' && (
                        <button onClick={() => setChangingEmail({ userId: s.user_id, name: s.full_name ?? 'this person', email: s.email })} className="flex h-8 items-center gap-1 rounded-[var(--radius-sm)] border border-border-strong px-2.5 text-[12px] font-medium text-foreground hover:bg-surface-subtle">
                          <Mail size={12} /> Change email
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
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="text-sm font-medium text-foreground">Payments &amp; billing</p>
              {/* FOUND LIVE (2026-09-10): this used to check
                  billing_status === 'active', which is driven entirely by
                  the Razorpay webhook — and with no real gateway wired up
                  for any plan (platform_plans.razorpay_plan_id is null
                  everywhere), billing_status is 'none' for every café,
                  forever, under the current manual-UPI reality this feature
                  exists to serve. That made the button unreachable for any
                  café, always. "The plan is active" means the café's own
                  account status, not the gateway subscription lifecycle —
                  account.status is what the badge in the header above
                  literally shows as "Active", and what actually means this
                  café is a live, paying (by personal UPI) customer. */}
              {permissions['subscriptions.manage'] && data.account.status === 'active' && (
                <button
                  onClick={() => setInvoiceModalOpen(true)}
                  className="flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] bg-primary px-3 text-[12.5px] font-medium text-primary-foreground hover:bg-primary-hover"
                >
                  <CreditCard size={13} /> Generate invoice
                </button>
              )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-[13.5px] sm:grid-cols-3">
              <Field label="Plan" value={planName(plans, data.account.plan)} />
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
            <p className="mt-2 text-[12px] text-muted-foreground">
              KhaoPiyo subscriptions are currently paid by personal UPI, outside this webhook entirely — &ldquo;Generate
              invoice&rdquo; is the paper trail for that, kept separately under Ops Admin → Billing → Invoices.
            </p>
          </section>
        )}

        {invoiceModalOpen && (
          <InvoiceGenerateModal
            cafeId={cafeId}
            cafeName={data.business.name}
            onClose={() => setInvoiceModalOpen(false)}
            onGenerated={() => router.refresh()}
          />
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

      {changingEmail && (
        <ChangeEmailDialog
          name={changingEmail.name}
          currentEmail={changingEmail.email}
          onClose={() => setChangingEmail(null)}
          onSubmit={async (newEmail) => {
            const res = await fetch('/api/ops/change-member-email', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                cafe_id: cafeId,
                target_user_id: changingEmail.userId ?? undefined,
                new_email: newEmail,
                old_email: changingEmail.email,
              }),
            })
            const body = await res.json().catch(() => ({}))
            if (!res.ok) return { ok: false as const, error: body.error ?? 'Could not change email.' }
            setChangingEmail(null)
            toast(`Email changed to ${body.email}.`)
            void refresh()
            void refreshStaff()
            return { ok: true as const }
          }}
        />
      )}
    </div>
  )
}

function ChangeEmailDialog({
  name,
  currentEmail,
  onClose,
  onSubmit,
}: {
  name: string
  currentEmail: string | null
  onClose: () => void
  onSubmit: (newEmail: string) => Promise<{ ok: true } | { ok: false; error: string }>
}) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !trimmed.includes('@')) return setError('Enter a valid email address.')
    setSubmitting(true)
    setError(null)
    const result = await onSubmit(trimmed)
    setSubmitting(false)
    if (!result.ok) setError(result.error)
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose}>
      <div className="w-full max-w-sm rounded-t-2xl bg-surface p-6 shadow-[var(--shadow-lg)] sm:rounded-[var(--radius-lg)]" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[15px] font-semibold text-foreground">Change email for {name}</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {currentEmail ? `Currently ${currentEmail}. ` : ''}Takes effect immediately, no confirmation email — this bypasses the usual proof they own the new address.
        </p>

        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="new@email.com"
          autoFocus
          className="mt-4 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3 py-2.5 text-[16px] text-foreground placeholder:text-muted-foreground"
        />

        {error && <p className="mt-3 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[12.5px] text-destructive">{error}</p>}

        <div className="mt-4 flex gap-2">
          <button onClick={onClose} className="min-h-11 flex-1 rounded-[var(--radius)] border border-border-strong text-[14px] font-medium text-foreground">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || email.trim().length === 0}
            className="min-h-11 flex-1 rounded-[var(--radius)] bg-primary text-[14px] font-medium text-white disabled:opacity-40"
          >
            {submitting ? 'Working…' : 'Change email'}
          </button>
        </div>
      </div>
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

/** A small labeled field for the Feature Control row's status columns (Plan
 *  Default / Effective / Manual Override) — same label-above-value shape as
 *  Field above, but the value is a node (a Badge, a switch) rather than plain
 *  text. */
function StatusField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
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
