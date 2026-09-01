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
  // /robots.txt, /sitemap.xml, and the standalone SEO landing pages. Every
  // other route (including /dashboard, /onboarding, /ops, auth pages, the
  // token-based /r, /t, /kds customer/staff routes, and all /api routes)
  // stays covered by updateSession() as before.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|$|about|blog|contact|pricing|legal|cloud-kitchen-pos-software|digital-menu-software|gst-billing-software-for-restaurants|kitchen-display-system|petpooja-alternative|pos-billing-software|qr-code-ordering-system|restaurant-inventory-management-software|restaurant-pos-software|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
