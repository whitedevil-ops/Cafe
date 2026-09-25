import { type NextRequest } from 'next/server'
import { updateSession } from '@/utils/supabase/middleware'

// Next 16 renamed `middleware` → `proxy` (nodejs runtime). This refreshes the
// Supabase session cookie and guards /dashboard and /onboarding.
export async function proxy(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  // Excludes fully public marketing/SEO pages (no auth check needed on them)
  // in addition to the pre-existing static-asset exclusions, so every
  // navigation to them doesn't pay for a round trip to Supabase Auth:
  // homepage ($ = exact "/"), /blog, /pricing, /about, /contact, /legal,
  // /robots.txt, /sitemap.xml, and the standalone SEO landing pages.
  //
  // api/print/poll, api/print/report, api/orders, api/kds and kds are a
  // second, different kind of exclusion (2026-09 Vercel invocation audit):
  // updateSession()'s own isProtected check already skips the Supabase work
  // for these — but that still costs a full middleware INVOCATION, billed
  // separately from the route's own invocation, on every single request.
  // Confirmed live: middleware invocations were 50.5% of total Vercel
  // Function Invocations, and these five routes are the highest-frequency
  // traffic in the app — the print bridge polls /api/print/poll every 4s
  // per café all day, and every open kitchen display polls /api/orders
  // every 5s. None of the five ever reads a cookie or Supabase session (bare
  // per-café bridge token for the print routes; slug-derived café lookup,
  // deliberately no-login by design, for /kds/[slug], its backing
  // /api/orders poll, and /api/kds/[slug]/done) — see each route's own
  // comment. Excluding them here means the middleware function does not run
  // AT ALL for these, not just less work inside it once it does. Every
  // other route (/dashboard, /onboarding, /ops, auth pages, the token-based
  // /r, /t routes, webhooks, every other /api route) stays covered by
  // updateSession() as before.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|$|about|blog|contact|pricing|legal|cloud-kitchen-pos-software|digital-menu-software|gst-billing-software-for-restaurants|kitchen-display-system|pos-software-alternative|pos-billing-software|qr-code-ordering-system|restaurant-inventory-management-software|restaurant-pos-software|faq|api/print/poll|api/print/report|api/orders|api/kds|kds|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
