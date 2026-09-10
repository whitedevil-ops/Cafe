'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { isDesktopApp } from '@/lib/is-desktop'

// The desktop app is a till, not a registration flow (2026-09-10) — a café
// owner opening the exe should only ever be able to sign in, never create an
// account or set up a new café from inside it. Registration and onboarding
// stay web-only.
//
// This is deliberately separate from desktop-session-bridge.tsx's one-shot
// launch decision (which only runs once per app session, by design, to avoid
// a bounce loop on the very first navigation). A café owner reaching
// /get-started or /onboarding is very rarely that first navigation — it's
// someone clicking a link, or an already-signed-in owner with no café yet
// being routed here by app/onboarding/page.tsx's own server-side redirect
// — so this has to react to every route change, not just launch.
//
// usePathname() re-runs this on every navigation, client-side or full load,
// for as long as the app is running — not a one-shot guard.
export const BLOCKED_PREFIXES = ['/signup', '/get-started', '/onboarding']

export function isBlocked(pathname: string): boolean {
  return BLOCKED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export function DesktopRouteGuard() {
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    if (!isDesktopApp() || !isBlocked(pathname)) return
    // A signed-in owner with no café yet lands here stuck at the login
    // form rather than signed out entirely — finishing setup is a web
    // task, but there's no reason to also destroy a session that's
    // otherwise perfectly valid.
    router.replace('/login')
  }, [pathname, router])

  return null
}
