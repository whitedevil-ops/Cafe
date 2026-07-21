import { cookies } from 'next/headers'
import { createClient } from '@/utils/supabase/server'

export type CurrentCafe = {
  userId: string
  cafeId: string
  role: string
  name: string
  slug: string
}

export type CafeOption = { cafeId: string; name: string; role: string }

const ACTIVE_CAFE_COOKIE = 'active_cafe'

type MembershipRow = {
  role: string
  cafe_id: string
  created_at: string
  cafes: { name: string; slug: string } | { name: string; slug: string }[] | null
}

// All cafés the signed-in user belongs to (RLS-scoped), newest first.
async function getMemberships(): Promise<{ userId: string; rows: MembershipRow[] } | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('cafe_members')
    .select('role, cafe_id, created_at, cafes(name, slug)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  return { userId: user.id, rows: (data ?? []) as MembershipRow[] }
}

function toOption(row: MembershipRow): CafeOption | null {
  const cafe = Array.isArray(row.cafes) ? row.cafes[0] : row.cafes
  if (!cafe) return null
  return { cafeId: row.cafe_id, name: cafe.name, role: row.role }
}

// The user's café list for the workspace switcher.
export async function getMyCafes(): Promise<CafeOption[]> {
  const m = await getMemberships()
  if (!m) return []
  return m.rows.map(toOption).filter((c): c is CafeOption => c !== null)
}

// Resolves the active café: the one picked in the switcher (cookie) if the user
// is still a member of it, else the newest membership. The cookie is only ever
// matched AGAINST the user's own memberships, so it can't select someone else's
// café — tenant access stays enforced by RLS regardless.
export async function getCurrentCafe(): Promise<CurrentCafe | null> {
  const m = await getMemberships()
  if (!m || m.rows.length === 0) return null

  const cookieStore = await cookies()
  const preferred = cookieStore.get(ACTIVE_CAFE_COOKIE)?.value
  const row = m.rows.find((r) => r.cafe_id === preferred) ?? m.rows[0]

  const cafe = Array.isArray(row.cafes) ? row.cafes[0] : row.cafes
  if (!cafe) return null

  return {
    userId: m.userId,
    cafeId: row.cafe_id,
    role: row.role,
    name: cafe.name,
    slug: cafe.slug,
  }
}
