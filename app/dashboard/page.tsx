import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()
  const [{ count: itemCount }, { count: categoryCount }] = await Promise.all([
    supabase.from('menu_items').select('*', { count: 'exact', head: true }).eq('cafe_id', cafe.cafeId),
    supabase.from('menu_categories').select('*', { count: 'exact', head: true }).eq('cafe_id', cafe.cafeId),
  ])

  const hasMenu = (itemCount ?? 0) > 0

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{cafe.name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Your workspace · role <span className="font-medium text-foreground">{cafe.role}</span>
      </p>

      {!hasMenu ? (
        <div className="mt-8 rounded-xl border border-border bg-surface p-8 text-center">
          <h2 className="text-base font-medium text-foreground">Add your first menu item</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Your café has no menu yet. Add items so customers can start ordering from the QR menu.
          </p>
          <Link
            href="/dashboard/menu"
            className="mt-5 inline-block rounded-[var(--radius)] bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Open menu manager
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {[
            ['Menu items', itemCount ?? 0],
            ['Categories', categoryCount ?? 0],
            ['Today’s orders', '—'],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-xl border border-border bg-surface p-5">
              <p className="text-[13px] text-muted-foreground">{label}</p>
              <p className="mt-1 text-3xl font-semibold tracking-tight text-foreground">{value}</p>
            </div>
          ))}
        </div>
      )}

      <p className="mt-6 text-[13px] text-muted-foreground">
        Live sales metrics appear here once orders start flowing through your QR menu.
      </p>
    </div>
  )
}
