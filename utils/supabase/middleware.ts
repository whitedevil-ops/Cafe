import { createServerClient } from '@supabase/ssr'
import { isAuthRetryableFetchError } from '@supabase/supabase-js'
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
    error: userError,
  } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isProtected =
    path.startsWith('/dashboard') ||
    path.startsWith('/onboarding') ||
    path.startsWith('/ops')

  // getUser() swallows a transient network/timeout failure reaching
  // Supabase Auth and returns { user: null } for it exactly like a genuine
  // "not signed in" — there is no retry cushioning in the SDK for this. Left
  // unguarded, a single connectivity blip would force-redirect an
  // already-signed-in café staffer to /login, which itself clears the real
  // session on arrival (by design, for the actual "sign in fresh" case) —
  // turning a momentary hiccup into a real, disruptive logout. Only redirect
  // on a confirmed absence of a session, not an inability to check right now.
  if (isProtected && !user && !isAuthRetryableFetchError(userError)) {
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
