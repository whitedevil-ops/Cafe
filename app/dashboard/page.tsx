import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { Button } from '@/components/ui/button'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // RLS scopes this to the caller's own memberships — tenant isolation, enforced by DB.
  const { data: memberships } = await supabase
    .from('cafe_members')
    .select('role, cafes(id, name, slug, city)')
    .eq('user_id', user.id)

  if (!memberships || memberships.length === 0) redirect('/onboarding')

  const first = memberships[0]
  const cafe = Array.isArray(first.cafes) ? first.cafes[0] : first.cafes

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[13px] text-muted-foreground">Signed in as {user.email}</p>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-foreground">
            {cafe?.name ?? 'Your café'}
          </h1>
        </div>
        <form action="/auth/signout" method="post">
          <Button variant="secondary" size="sm" type="submit">
            Sign out
          </Button>
        </form>
      </div>

      <div className="mt-8 rounded-xl border border-border bg-surface p-6">
        <p className="text-sm text-muted-foreground">
          Your workspace is live. Dashboard metrics, POS, orders, and menu management wire in
          next — each reading only this café&apos;s data through row-level security.
        </p>
        <p className="mt-4 text-[13px] text-muted-foreground">
          Role: <span className="font-medium text-foreground">{first.role}</span>
          {cafe?.city ? ` · ${cafe.city}` : ''}
        </p>
      </div>
    </div>
  )
}
