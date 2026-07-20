import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'

export const dynamic = 'force-dynamic'

const nav = [
  ['Overview', '/dashboard'],
  ['Menu', '/dashboard/menu'],
  ['Tables', '/dashboard/tables'],
  ['Kitchen', '/dashboard/kitchen'],
  ['Settings', '/dashboard/settings'],
]

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  return (
    <div className="flex min-h-dvh bg-background">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface px-4 py-6 md:flex">
        <div className="px-2">
          <p className="text-lg font-semibold tracking-tight text-foreground">counter</p>
          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{cafe.name}</p>
        </div>
        <nav className="mt-8 space-y-0.5">
          {nav.map(([label, href]) => (
            <Link
              key={href}
              href={href}
              className="block rounded-[var(--radius)] px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-surface-subtle hover:text-foreground"
            >
              {label}
            </Link>
          ))}
        </nav>
        <form action="/auth/signout" method="post" className="mt-auto px-1">
          <button className="text-[13px] text-muted-foreground hover:text-foreground">Sign out</button>
        </form>
      </aside>

      {/* Mobile top bar */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border bg-surface px-5 py-3 md:hidden">
          <span className="font-semibold tracking-tight text-foreground">counter</span>
          <nav className="flex gap-3 text-[13px]">
            {nav.map(([label, href]) => (
              <Link key={href} href={href} className="text-muted-foreground hover:text-foreground">
                {label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  )
}
