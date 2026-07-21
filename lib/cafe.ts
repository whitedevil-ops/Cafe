import { createClient } from '@/utils/supabase/server'

export type CurrentCafe = {
  userId: string
  cafeId: string
  role: string
  name: string
  slug: string
}

// Resolves the signed-in user's primary café via RLS-scoped membership.
// Returns null if not signed in or not yet a member of any café.
export async function getCurrentCafe(): Promise<CurrentCafe | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  // Newest membership wins (deterministic; previously unordered). This also means
  // seeding the demo café makes it your active workspace — reset-demo-cafe.sql
  // deletes that membership and your original café comes back.
  const { data } = await supabase
    .from('cafe_members')
    .select('role, cafe_id, created_at, cafes(name, slug)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return null
  const cafe = Array.isArray(data.cafes) ? data.cafes[0] : data.cafes
  if (!cafe) return null

  return {
    userId: user.id,
    cafeId: data.cafe_id,
    role: data.role,
    name: cafe.name,
    slug: cafe.slug,
  }
}
