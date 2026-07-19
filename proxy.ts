import { type NextRequest } from 'next/server'
import { updateSession } from '@/utils/supabase/middleware'

// Next 16 renamed `middleware` → `proxy` (nodejs runtime). This refreshes the
// Supabase session cookie and guards /dashboard and /onboarding.
export async function proxy(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
