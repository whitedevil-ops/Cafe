import { redirect } from 'next/navigation'
import { getCurrentCafe, getMyCafes } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import { AppShell } from '@/components/shell/app-shell'
import { ExpiryRenewal } from '@/components/billing/expiry-renewal'
import { UserActivityTracker } from '@/components/user-activity-tracker'
import { OperatorSessionBanner } from '@/components/shell/operator-session-banner'

export const dynamic = 'force-dynamic'

const STATUS_MESSAGE: Record<string, string> = {
  suspended: 'This café account has been suspended.',
  disabled: 'This café account has been disabled.',
  archived: 'This café account has been archived.',
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [cafe, myCafes] = await Promise.all([getCurrentCafe(), getMyCafes()])
  if (!cafe) redirect('/onboarding')

  // Rendered on EVERY branch below, including the suspended-account screens.
  // A suspended café is exactly when an operator has reason to be here, and
  // those screens offer only "Sign out" — which for an operator is the wrong
  // exit entirely: it would drop the Supabase session while leaving the café
  // session open in the database until it timed out.
  const banner = cafe.operator ? (
    <OperatorSessionBanner cafeName={cafe.name} session={cafe.operator} />
  ) : null

  const supabase = await createClient()
  const [{ data: cafeRow }, { data: profile }, { data: capacity }, { data: overrideRows }, { data: screenAccess }] = await Promise.all([
    supabase.from('cafes').select('cash_management_enabled, plan').eq('id', cafe.cafeId).maybeSingle(),
    supabase.from('profiles').select('full_name').eq('id', cafe.userId).maybeSingle(),
    supabase.rpc('owned_cafe_capacity'),
    supabase.from('cafe_feature_overrides').select('feature_key, enabled').eq('cafe_id', cafe.cafeId),
    supabase.rpc('my_screen_access', { p_cafe_id: cafe.cafeId }),
  ])
  const canAddCafe = Boolean((capacity as { can_add?: boolean } | null)?.can_add)

  // Same override-beats-plan-default precedence as cafe_has_feature(), just
  // resolved once here for every nav-relevant key instead of one RPC round
  // trip per key — this only decides whether to SHOW a nav link (a courtesy),
  // every gated page still independently re-checks via hasFeature() server-side.
  const { data: planRow } = await supabase.from('platform_plans').select('name, features').eq('key', cafeRow?.plan ?? '').maybeSingle()
  const planFeatures = (planRow?.features ?? {}) as Record<string, boolean>
  const overrideMap = new Map((overrideRows ?? []).map((o) => [o.feature_key, o.enabled]))
  const navFeatures: Record<string, boolean> = {}
  for (const key of ['crm', 'feedback', 'inventory', 'coupons', 'loyalty', 'expenses', 'wallet', 'reservations', 'advanced_analytics']) {
    navFeatures[key] = overrideMap.has(key) ? overrideMap.get(key)! : (planFeatures[key] ?? false)
  }

  if (cafe.status !== 'active') {
    // Auto-suspension from the expiry cron (0114 + check-expiry/route.ts)
    // sets this exact status_reason — distinguished from a manual operator
    // suspension (which keeps the generic message below, since "renew your
    // plan" would be misleading if the real reason is something else).
    const isExpiry = cafe.status === 'suspended' && cafe.statusReason === 'Subscription expired'
    if (isExpiry) {
      const planKey = cafeRow?.plan ?? 'trial'
      const planName = planRow?.name ?? planKey
      return (
        <>
        {banner}
        <div className="grid w-full min-h-dvh place-items-center bg-background px-6 py-12 text-center">
          <div className="w-full max-w-lg">
            <p className="text-sm font-medium text-destructive">Account access paused</p>
            <h1 className="mt-2 text-xl font-semibold text-foreground">
              {planKey === 'trial' ? 'Your trial period has ended' : `Your ${planName} plan has ended`}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Renew to get back to billing, QR ordering, and your kitchen display.
            </p>
            <ExpiryRenewal cafeId={cafe.cafeId} />
            <form action="/auth/signout" method="post" className="mt-6">
              <button className="text-sm font-medium text-primary hover:underline">Sign out</button>
            </form>
          </div>
        </div>
        </>
      )
    }
    return (
      <>
      {banner}
      <div className="grid w-full min-h-dvh place-items-center bg-background px-6 text-center">
        <div>
          <p className="text-sm font-medium text-destructive">Account access paused</p>
          <h1 className="mt-2 text-xl font-semibold text-foreground">
            {STATUS_MESSAGE[cafe.status] ?? 'This café account is not currently active.'}
          </h1>
          {cafe.statusReason && (
            <p className="mt-2 text-sm text-muted-foreground">Reason: {cafe.statusReason}</p>
          )}
          <p className="mt-2 text-sm text-muted-foreground">
            Orders, POS, and staff access are paused until this is resolved. Contact support to continue.
          </p>
          <form action="/auth/signout" method="post" className="mt-6">
            <button className="text-sm font-medium text-primary hover:underline">Sign out</button>
          </form>
        </div>
      </div>
      </>
    )
  }

  // Fail OPEN (full access) if the RPC errors — e.g. mid-deploy before its
  // migration has run — rather than lock every existing staff session out
  // of the whole dashboard because a lookup hiccuped, same posture as the
  // QR ordering kill-switch check.
  const ALL_SCREENS = [
    'dashboard', 'pos', 'tables', 'bills', 'shift', 'kitchen', 'menu', 'customers', 'feedback',
    'inventory', 'purchases', 'recipes', 'coupons', 'loyalty', 'wallet', 'reservations', 'reports',
    'analytics', 'expenses', 'profile', 'qr_codes', 'billing', 'settings',
  ]

  return (
    <AppShell
      cafeName={cafe.name}
      cafeId={cafe.cafeId}
      role={cafe.role}
      timezone={cafe.timezone}
      cashEnabled={cafeRow?.cash_management_enabled ?? false}
      features={navFeatures}
      // An operator session has no cafe_members row, so my_screen_access()
      // returns an EMPTY array rather than null — and `[] ?? ALL_SCREENS` is
      // `[]`, so every screen fell behind the role-restricted screen. 0135
      // fixes that at source in SQL; this stays as the belt to its braces,
      // and makes the fix effective the moment this deploys rather than
      // whenever the migration lands. Grants nothing — the operator already
      // has row access via is_cafe_member(); this only stops the UI hiding it.
      screenAccess={cafe.role === 'operator' ? ALL_SCREENS : ((screenAccess as string[] | null) ?? ALL_SCREENS)}
      cafes={myCafes}
      canAddCafe={canAddCafe}
      userName={profile?.full_name ?? ''}
    >
      {banner}
      {/* Records last-active + device for the operator console. Mounted here
          rather than per page so it covers the whole dashboard, and only
          inside the active-café branch — a suspended account staring at the
          paused screen is not "active use". */}
      <UserActivityTracker />
      {children}
    </AppShell>
  )
}
