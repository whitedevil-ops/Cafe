import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Refreshes the auth session on every request and guards dashboard routes.
// Invoked from proxy.ts (Next 16's renamed middleware).
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  // If Supabase isn't configured (e.g. env vars not set on the host), never crash the
  // whole site — just serve pages without a session. Auth routes will handle it.
  if (!url || !key) return response

  const supabase = createServerClient(
    url,
    key,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isProtected =
    path.startsWith('/dashboard') ||
    path.startsWith('/onboarding') ||
    path.startsWith('/platform-admin')

  if (isProtected && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', path)
    return NextResponse.redirect(url)
  }

  // Deliberately NOT redirecting a signed-in user away from /login or
  // /signup here. Both pages already sign out on arrival client-side
  // (see their own useEffect) specifically so switching accounts, or a
  // second browser tab landing on the marketing site while another tab
  // is signed in, always reaches a real login form — cookies are shared
  // per browser, not per tab, so a middleware redirect here ran BEFORE
  // that page-level logic ever got a chance to fire, silently defeating
  // it. Confirmed live: a second tab clicking "Log in" landed straight on
  // /dashboard instead of the login form.
  return response
}
