import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { AccountMenu } from '@/components/platform-admin/account-menu'
import { MobileNav } from '@/components/platform-admin/mobile-nav'
import { SidebarNav, type NavKey } from '@/components/platform-admin/sidebar-nav'

export const dynamic = 'force-dynamic'

// Internal tooling, and the tab title should say so rather than inheriting the
// marketing site's. noindex is belt-and-braces — robots.ts already disallows
// /platform-admin, and the route is behind an auth gate regardless.
export const metadata: Metadata = {
  title: { default: 'Operator console', template: '%s · Operator console' },
  robots: { index: false, follow: false },
}

type AdminContext = { admin_id: string; role: string; full_name: string; email: string; permissions: Record<string, boolean> }

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
  // platform_admin_context() returns null for anyone who isn't an active
  // admin, and the caller's fully-resolved (role default + override)
  // permission set for everyone who is — every op_* RPC re-checks the
  // specific permission it needs independently, this is only what decides
  // which nav links this admin sees.
  const { data: context } = await supabase.rpc('platform_admin_context')
  const ctx = context as AdminContext | null
  if (!ctx) {
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

  // Best-effort — never blocks rendering on it, but does need to complete
  // before the response finishes (serverless functions don't guarantee an
  // unawaited promise runs to completion after the function returns).
  await supabase.rpc('op_touch_admin_login')

  // Which nav entries this admin may see. Presentation (order, grouping,
  // icons, active state) is the nav component's business; this is only the
  // permission decision, which stays server-side.
  const allowed: NavKey[] = ([
    ['overview', true],
    ['cafes', ctx.permissions['cafes.view']],
    ['users', ctx.permissions['users.view']],
    ['leads', ctx.permissions['leads.view']],
    ['health', ctx.permissions['health.view']],
    ['audit', ctx.permissions['audit.view']],
    ['admins', ctx.permissions['admins.view']],
  ] as [NavKey, boolean | undefined][])
    .filter(([, show]) => show)
    .map(([key]) => key)

  return (
    <div className="flex w-full min-h-dvh flex-col bg-background md:flex-row">
      {/* Deliberately dark, distinct from the light café dashboard — this is
          the platform's own operations console, never to be mistaken for it. */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-white/[0.07] bg-[#0B0D10] px-3 py-5 md:flex">
        <div className="px-2">
          <div className="flex items-center gap-2">
            <Image src="/logo-mark.png" alt="" width={24} height={24} className="h-6 w-6" />
            <p className="text-[17px] font-semibold tracking-tight text-white">KhaoPiyo</p>
          </div>
          <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-wide text-amber-300">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            Operator console
          </p>
        </div>

        <div className="mt-4 border-t border-white/[0.07] pt-4">
          <AccountMenu fullName={ctx.full_name} role={ctx.role} email={ctx.email} />
        </div>

        {/* Scrolls independently so a long nav can never push Sign out off the
            bottom of a short laptop screen. */}
        <div className="mt-5 min-h-0 flex-1 overflow-y-auto">
          <SidebarNav allowed={allowed} />
        </div>

        <form action="/auth/signout" method="post" className="mt-4 border-t border-white/[0.07] px-3 pt-3">
          <button className="text-[12.5px] text-white/45 transition-colors hover:text-white">Sign out</button>
        </form>
      </aside>

      <MobileNav allowed={allowed} />

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  )
}
