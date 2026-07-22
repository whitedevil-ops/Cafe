import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'

export const dynamic = 'force-dynamic'

const nav = [
  ['Overview', '/platform-admin'],
  ['Cafés', '/platform-admin/cafes'],
  ['Users', '/platform-admin/users'],
  ['Audit logs', '/platform-admin/audit-logs'],
]

export default async function PlatformAdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/platform-admin')

  // Server-side authorization (spec §1): the ONLY gate. Never trust the client.
  const { data: isAdmin } = await supabase.rpc('is_platform_admin')
  if (!isAdmin) {
    // Safe denial — no platform data is rendered, no hint of what exists.
    return (
      <div className="grid w-full min-h-dvh place-items-center bg-background px-6 text-center">
        <div>
          <p className="text-sm font-medium text-destructive">403 — Not authorized</p>
          <h1 className="mt-2 text-xl font-semibold text-foreground">
            This area is for platform administrators.
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You&apos;re signed in, but your account doesn&apos;t have platform access.
          </p>
          <Link href="/dashboard" className="mt-6 inline-block text-sm font-medium text-primary hover:underline">
            Go to your café dashboard →
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex w-full min-h-dvh flex-col bg-background md:flex-row">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface px-4 py-6 md:flex">
        <div className="px-2">
          <p className="text-lg font-semibold tracking-tight text-foreground">counter</p>
          <p className="mt-0.5 text-[12px] font-medium text-primary">Platform admin</p>
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

      {/* Mobile nav — the sidebar above is md:flex only; without this, a phone
          user had no way to navigate the platform-admin panel at all. */}
      <header className="border-b border-border bg-surface px-5 py-3 md:hidden">
        <div className="flex items-center justify-between">
          <span className="font-semibold tracking-tight text-foreground">counter</span>
          <span className="text-[12px] font-medium text-primary">Platform admin</span>
        </div>
        <nav className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[13px]">
          {nav.map(([label, href]) => (
            <Link key={href} href={href} className="text-muted-foreground hover:text-foreground">
              {label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  )
}
