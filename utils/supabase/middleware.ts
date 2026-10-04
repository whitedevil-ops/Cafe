import { createServerClient } from '@supabase/ssr'
import { isAuthRetryableFetchError } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'

// Refreshes the auth session on every request and guards dashboard routes.
// Invoked from proxy.ts (Next 16's renamed middleware).
export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname
  const isProtected =
    path.startsWith('/dashboard') ||
    path.startsWith('/onboarding') ||
    path.startsWith('/ops')

  // Everything below this point (constructing a Supabase server client and
  // paying for a getUser() round trip) exists ONLY to answer one question:
  // "is this signed-out visitor allowed past a protected route?" — the
  // redirect check further down never even looks at `user`/`userError`
  // unless `isProtected` is true. Every other route proxy.ts's matcher lets
  // through — /api/print/poll (bare per-café bridge token, never a cookie),
  // /kds/* and its /api/orders backing route (deliberately no-login kitchen
  // display, see lib/db.ts's own comment), Razorpay/other webhooks
  // (signature-verified, not cookie-verified), /login, /signup, /r/[token]
  // and /t/[token] (guest-token pages, no Supabase session at all) — none
  // of them consume this. Found in the 2026-09 Vercel Active CPU audit:
  // /api/print/poll alone is hit every 4 seconds, per café, all day by the
  // desktop print bridge, so this was a guaranteed-wasted Supabase Auth
  // client build + getUser() call on the single highest-volume route in the
  // app, repeated forever, for a result nothing downstream ever reads.
  if (!isProtected) {
    return NextResponse.next({ request })
  }

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

  // getClaims(), not getUser(): this project signs its tokens with an
  // asymmetric key (ES256, published at /auth/v1/.well-known/jwks.json), so the
  // token's signature and expiry can be verified HERE, against a key the
  // library caches for the whole server process — no network round trip.
  // getUser() asked Supabase Auth over the wire on every request, and a
  // dashboard page load fires ~20 of them (the sidebar's prefetches each pass
  // through this proxy), each a ~100ms trip that every page switch waited on.
  // An expiring token is still refreshed here and the cookie rewritten
  // (getClaims() goes through getSession()), and a token the library cannot
  // verify locally (an older HS256 one) falls back to the network check on its
  // own — so the only thing given up is noticing a REVOKED session before its
  // access token expires (at most an hour). RLS never noticed that either: the
  // database trusts the same signed token, so nothing the revoked session could
  // still read was ever protected by this call. /ops and every sensitive
  // route handler keep getUser().
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims()
  const signedIn = Boolean(claimsData?.claims?.sub)

  // A transient network/timeout failure reaching Supabase Auth (only possible
  // now on the HS256 fallback or a refresh) comes back as an error with no
  // claims, exactly like a genuine "not signed in" — there is no retry
  // cushioning in the SDK for this. Left unguarded, a single connectivity blip
  // would force-redirect an already-signed-in café staffer to /login, which
  // itself clears the real session on arrival (by design, for the actual "sign
  // in fresh" case) — turning a momentary hiccup into a real, disruptive
  // logout. Only redirect on a confirmed absence of a session, not an
  // inability to check right now. (`isProtected` is already known true here —
  // the early return above handles every non-protected route.)
  if (!signedIn && !isAuthRetryableFetchError(claimsError)) {
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
