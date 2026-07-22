import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentCafe, getMyCafes } from '@/lib/cafe'
import { CafeSwitcher } from '@/components/cafe-switcher'
import { NotificationBell } from '@/components/notification-bell'

export const dynamic = 'force-dynamic'

// Grouped per the target IA. Only sections with a page that actually exists
// are linked — Reservations/Inventory/Reports etc. are Phase 2/3 and will
// join their group once built, rather than shipping dead links now.
const groups: [string, [string, string][]][] = [
  ['Overview', [
    ['Dashboard', '/dashboard'],
    ['Live tables', '/dashboard/tables'],
    ['Kitchen', '/dashboard/kitchen'],
  ]],
  ['Management', [
    ['Menu', '/dashboard/menu'],
  ]],
  ['Business', [
    ['Café profile', '/dashboard/profile'],
    ['QR codes', '/dashboard/tables/manage'],
    ['Settings', '/dashboard/settings'],
  ]],
]
const flatNav = groups.flatMap(([, items]) => items)

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [cafe, myCafes] = await Promise.all([getCurrentCafe(), getMyCafes()])
  if (!cafe) redirect('/onboarding')

  return (
    <div className="flex w-full min-h-dvh bg-background">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface px-4 py-6 md:flex">
        <div className="flex items-start justify-between px-2">
          <div className="min-w-0">
            <p className="text-lg font-semibold tracking-tight text-foreground">counter</p>
            <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{cafe.name}</p>
          </div>
          <NotificationBell cafeId={cafe.cafeId} />
        </div>
        <div className="px-2">
          <CafeSwitcher cafes={myCafes} activeCafeId={cafe.cafeId} />
        </div>
        <nav className="mt-6 space-y-5">
          {groups.map(([section, items]) => (
            <div key={section}>
              <p className="px-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{section}</p>
              <div className="mt-1 space-y-0.5">
                {items.map(([label, href]) => (
                  <Link
                    key={href}
                    href={href}
                    className="block rounded-[var(--radius)] px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-surface-subtle hover:text-foreground"
                  >
                    {label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <form action="/auth/signout" method="post" className="mt-auto px-1">
          <button className="text-[13px] text-muted-foreground hover:text-foreground">Sign out</button>
        </form>
      </aside>

      {/* Mobile top bar */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-border bg-surface px-5 py-3 md:hidden">
          <div className="flex items-center justify-between">
            <span className="font-semibold tracking-tight text-foreground">counter</span>
            <div className="flex items-center gap-1">
              <NotificationBell cafeId={cafe.cafeId} />
            </div>
          </div>
          <nav className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[13px]">
            {flatNav.map(([label, href]) => (
              <Link key={href} href={href} className="text-muted-foreground hover:text-foreground">
                {label}
              </Link>
            ))}
          </nav>
          <CafeSwitcher cafes={myCafes} activeCafeId={cafe.cafeId} />
        </header>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  )
}
