import { cache } from 'react'
import { cookies } from 'next/headers'
import { createClient } from '@/utils/supabase/server'
import { DEFAULT_TIMEZONE } from '@/lib/datetime'

export type CurrentCafe = {
  userId: string
  cafeId: string
  role: string
  name: string
  slug: string
  status: string
  statusReason: string | null
  /** IANA zone used for every date the café sees. Never assume Asia/Kolkata. */
  timezone: string
  /** Set only while a platform operator is inside this café (migration 0134). */
  operator?: OperatorSession
}

/** Present only during an operator session — drives the dashboard banner. */
export type OperatorSession = {
  sessionId: string
  reason: string
  expiresAt: string
  adminName: string | null
}

export type CafeOption = { cafeId: string; name: string; role: string }

const ACTIVE_CAFE_COOKIE = 'active_cafe'

// A hint, never an authority. Set when an operator session starts and cleared
// when it ends, purely so the ~every-request impersonation_context() lookup is
// skipped for the overwhelming majority of visitors, who are café staff with
// no session at all. Anyone can forge this cookie; all it buys them is one RPC
// call that returns null, because the database decides.
const OPS_SESSION_HINT = 'kp_ops_session'

type ImpersonationRow = {
  session_id: string
  cafe_id: string
  name: string
  slug: string
  status: string
  status_reason: string | null
  timezone: string
  reason: string
  expires_at: string
  admin_name: string | null
}

// cache() for the same reason getMemberships uses it: layout and page both ask,
// and one request should mean one lookup.
const getImpersonation = cache(async (): Promise<ImpersonationRow | null> => {
  const cookieStore = await cookies()
  if (!cookieStore.get(OPS_SESSION_HINT)) return null

  const supabase = await createClient()
  const { data } = await supabase.rpc('impersonation_context')
  return (data as ImpersonationRow | null) ?? null
})

type MembershipRow = {
  role: string
  cafe_id: string
  created_at: string
  cafes:
    | { name: string; slug: string; status: string; status_reason: string | null; timezone: string | null; onboarding_step: string | null; trial_ends_at: string | null; subscription_ends_at: string | null }
    | { name: string; slug: string; status: string; status_reason: string | null; timezone: string | null; onboarding_step: string | null; trial_ends_at: string | null; subscription_ends_at: string | null }[]
    | null
}

const SELECT_COLS =
  'role, cafe_id, created_at, cafes(name, slug, status, status_reason, timezone, onboarding_step, trial_ends_at, subscription_ends_at)'

// A café still mid-onboarding (details submitted but the wizard not
// finished) isn't a usable workspace yet — treated the same as "no
// membership" everywhere below, so the dashboard correctly bounces back to
// /onboarding instead of rendering a half-set-up café.
function isUsable(row: MembershipRow): boolean {
  const cafe = Array.isArray(row.cafes) ? row.cafes[0] : row.cafes
  return Boolean(cafe) && (cafe!.onboarding_step ?? 'complete') === 'complete'
}

// All cafés the signed-in user belongs to (RLS-scoped), newest first.
// Wrapped in React cache() so layout + page share ONE auth check and ONE
// membership query per request instead of re-fetching independently.
const getMemberships = cache(
  async (): Promise<{ userId: string; rows: MembershipRow[] } | null> => {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return null

    const { data } = await supabase
      .from('cafe_members')
      .select(SELECT_COLS)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    let rows = (data ?? []) as MembershipRow[]

    // No memberships? The user may have been invited by a café before signing
    // up — claim any invites matching their email, then re-read.
    if (rows.length === 0) {
      const { data: claimed } = await supabase.rpc('claim_my_invites')
      if (claimed && claimed > 0) {
        const { data: refetched } = await supabase
          .from('cafe_members')
          .select(SELECT_COLS)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
        rows = (refetched ?? []) as MembershipRow[]
      }
    }

    return { userId: user.id, rows: rows.filter(isUsable) }
  },
)

function toOption(row: MembershipRow): CafeOption | null {
  const cafe = Array.isArray(row.cafes) ? row.cafes[0] : row.cafes
  if (!cafe) return null
  return { cafeId: row.cafe_id, name: cafe.name, role: row.role }
}

// The user's café list for the workspace switcher.
export async function getMyCafes(): Promise<CafeOption[]> {
  // Inside an operator session the switcher lists only the café being visited.
  // Offering the operator's own cafés here would be an invitation to switch
  // away and leave the session quietly open behind them; leaving it empty
  // would break the shell, which expects the current café to be in the list.
  const imp = await getImpersonation()
  if (imp) return [{ cafeId: imp.cafe_id, name: imp.name, role: 'operator' }]

  const m = await getMemberships()
  if (!m) return []
  return m.rows.map(toOption).filter((c): c is CafeOption => c !== null)
}

// Resolves the active café: the one picked in the switcher (cookie) if the user
// is still a member of it, else the newest membership. The cookie is only ever
// matched AGAINST the user's own memberships, so it can't select someone else's
// café — tenant access stays enforced by RLS regardless.
export async function getCurrentCafe(): Promise<CurrentCafe | null> {
  const [m, imp] = await Promise.all([getMemberships(), getImpersonation()])
  if (!m) return null

  // An open operator session outranks the operator's own memberships. Without
  // this precedence an operator who also owns a café would start a session,
  // land on their OWN dashboard, and read someone else's café name in the
  // banner — the worst possible failure for a feature whose whole safety story
  // is "you always know whose data you are looking at".
  //
  // role is 'operator', which matches neither 'owner' nor 'manager', so every
  // `role === 'owner' || role === 'manager'` gate in the dashboard hides its
  // controls without needing to learn about sessions. has_cafe_role() is
  // deliberately NOT widened in 0134 either, so owner/manager-only writes
  // (menu edits, staff changes) refuse at the database as well as in the UI.
  if (imp) {
    return {
      userId: m.userId,
      cafeId: imp.cafe_id,
      role: 'operator',
      name: imp.name,
      slug: imp.slug,
      status: imp.status,
      statusReason: imp.status_reason,
      timezone: imp.timezone || DEFAULT_TIMEZONE,
      operator: {
        sessionId: imp.session_id,
        reason: imp.reason,
        expiresAt: imp.expires_at,
        adminName: imp.admin_name,
      },
    }
  }

  if (m.rows.length === 0) return null

  const cookieStore = await cookies()
  const preferred = cookieStore.get(ACTIVE_CAFE_COOKIE)?.value
  const row = m.rows.find((r) => r.cafe_id === preferred) ?? m.rows[0]

  const cafe = Array.isArray(row.cafes) ? row.cafes[0] : row.cafes
  if (!cafe) return null

  // Lazily starts the 14-day trial clock on the owner's first dashboard load
  // after login — cheaper than hooking every possible sign-in path, and
  // naturally a no-op after the first call since the RPC only writes when
  // both dates are still null (see migration 0118).
  if (row.role === 'owner' && cafe.trial_ends_at === null && cafe.subscription_ends_at === null) {
    const supabase = await createClient()
    await supabase.rpc('ensure_trial_started', { p_cafe_id: row.cafe_id })
  }

  return {
    userId: m.userId,
    cafeId: row.cafe_id,
    role: row.role,
    name: cafe.name,
    slug: cafe.slug,
    status: cafe.status,
    statusReason: cafe.status_reason,
    timezone: cafe.timezone ?? DEFAULT_TIMEZONE,
  }
}
