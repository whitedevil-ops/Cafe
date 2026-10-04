'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/utils/supabase/client'
import { isDesktopApp } from '@/lib/is-desktop'
import {
  saveStoredSession,
  loadStoredSession,
  clearStoredSession,
  sessionEventAction,
  claimNavigationSlot,
} from '@/lib/desktop-session'
import { decideLaunch, type LaunchState } from '@/lib/desktop-launch'
import { setAuthPhase, AUTH_PHASE_TIMEOUT_MS } from '@/lib/desktop-auth-phase'

// Keeps the desktop app signed in across restarts, and lands it somewhere
// useful when it opens.
//
// The webview does not persist cookies — not late, not partially: it never
// opens the cookie database at all, while writing cache and local storage to
// the same profile quite happily. So the session is handed to the Rust side,
// which writes it to a file the webview has no say over, and handed back on
// the next launch.
//
// Does nothing at all in a browser, where cookies work and this would be a
// second source of truth fighting the first.

/**
 * Recent automatic navigations in this window session (timestamps).
 *
 * The app may route itself at most twice in any 20 seconds. If a restored
 * cookie somehow does not reach the server, /dashboard bounces back to /login,
 * which would send it to /dashboard again — an endless loop on the café's
 * till, which is far worse than showing a login form. This used to be ONE
 * navigation per window session; a launch spent it, and a later reload that
 * had to restore again restored fine and then stayed on the login form. See
 * claimNavigationSlot.
 */
const ROUTED_KEY = 'kp:desktop:launch-routed'

function claimNavigation(): boolean {
  try {
    let history: unknown = null
    try {
      const raw = sessionStorage.getItem(ROUTED_KEY)
      history = raw ? JSON.parse(raw) : null
    } catch {
      history = null // the previous build stored a bare '1' here
    }
    const { allowed, next } = claimNavigationSlot(history, Date.now())
    if (allowed) sessionStorage.setItem(ROUTED_KEY, JSON.stringify(next))
    return allowed
  } catch {
    // No sessionStorage means no way to prove this is not a loop, so don't
    // risk it.
    return false
  }
}

/**
 * Runs the decision from lib/desktop-launch against the real window. Returns
 * true when it has started navigating away — the caller must then NOT reveal
 * the login form, because this document is about to be replaced.
 */
function applyLaunch(state: Omit<LaunchState, 'pathname' | 'search'>): boolean {
  const action = decideLaunch({
    ...state,
    pathname: window.location.pathname,
    search: window.location.search,
  })
  if (action.kind === 'stay') return false
  if (!claimNavigation()) return false
  if (action.kind === 'reload') window.location.reload()
  else window.location.replace(action.to)
  return true
}

/** Does this submitted form sign the user out? (All four Sign out buttons post to /auth/signout.) */
function isSignOutForm(target: EventTarget | null): boolean {
  const action = (target as HTMLFormElement | null)?.getAttribute?.('action')
  if (!action) return false
  try {
    return new URL(action, window.location.href).pathname === '/auth/signout'
  } catch {
    return false
  }
}

export function DesktopSessionBridge() {
  const ran = useRef(false)

  useEffect(() => {
    if (!isDesktopApp() || ran.current) return
    ran.current = true

    const supabase = createClient()
    let unsubscribe: (() => void) | undefined

    // The login form waits on this (lib/desktop-auth-phase). Whatever happens
    // below, it is released — and the timeout is the backstop for a stuck
    // IPC call, so the worst case is a slower form, never a missing one.
    const settle = () => setAuthPhase('ready')
    const failSafe = window.setTimeout(settle, AUTH_PHASE_TIMEOUT_MS)

    // Signing out by the button is a server round trip (POST /auth/signout), so
    // no sign-out event ever reaches this document. Drop the stored session
    // BEFORE the request leaves: otherwise the next launch would find it and
    // sign the café straight back in as whoever just left, and the only thing
    // standing in the way would be the server having managed to revoke it.
    const onSubmit = (e: Event) => {
      if (isSignOutForm(e.target)) void clearStoredSession()
    }
    document.addEventListener('submit', onSubmit, true)

    void (async () => {
      // Save on every sign-in and every silent refresh. Storing only at login
      // would leave a token that quietly ages out, and the café would be
      // signed out days later for no visible reason.
      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        // See sessionEventAction: INITIAL_SESSION with no session is "this
        // document has no cookie yet", NOT a sign-out, and deleting on it
        // destroyed the session this very bridge was about to restore.
        const action = sessionEventAction(event, session)
        if (action === 'clear') {
          void clearStoredSession()
        } else if (action === 'save' && session) {
          // saveStoredSession is a no-op when "Keep me signed in" is off, so
          // the café's choice is honoured without this needing to know about it.
          void saveStoredSession({
            access_token: session.access_token,
            refresh_token: session.refresh_token,
          })
        }
      })
      unsubscribe = () => data.subscription.unsubscribe()

      // Already signed in — never overwrite it, that would log the café out of
      // the account they just signed into. But if the app is parked on the
      // marketing site, take it to the till.
      const { data: current } = await supabase.auth.getSession()
      if (current.session) {
        if (!applyLaunch({ hasSession: true, restored: false })) settle()
        return
      }

      const stored = await loadStoredSession()
      if (!stored) {
        // Nothing to restore. Still worth leaving the homepage: an app that
        // opens on its own marketing page looks broken, and the café has to
        // hunt for "Log in" before it can do anything.
        if (!applyLaunch({ hasSession: false, restored: false })) settle()
        return
      }

      const { error } = await supabase.auth.setSession({
        access_token: stored.access_token,
        refresh_token: stored.refresh_token,
      })
      if (error) {
        // FOUND LIVE (full-product audit, 2026-09-10): setSession()
        // internally refreshes the (almost certainly already-expired,
        // freshly-loaded-from-disk) access token, and a pure network/offline
        // failure during THAT refresh comes back as this exact same `error`
        // shape — auth-js itself wraps it as AuthRetryableFetchError
        // precisely so its own internal logic can tell "the refresh token is
        // dead" apart from "could not reach the server this instant". This
        // code used to treat every error identically as "revoked or expired
        // past recovery" and permanently delete the one credential ("Keep me
        // signed in") that exists for exactly this scenario: a till that
        // autostarts with Windows before the router/internet is back up
        // after a power cycle. Only clear the stored session on a genuine
        // rejection; a retryable/network error leaves it alone so the next
        // launch gets another chance instead of silently signing out.
        if (error.name !== 'AuthRetryableFetchError') {
          void clearStoredSession()
        }
        if (!applyLaunch({ hasSession: false, restored: false })) settle()
        return
      }

      // setSession writes the auth cookie in the page, but the server rendered
      // this document before it existed, so it has to be fetched again either
      // way. Going to the dashboard rather than reloading is the whole point:
      // a reload here just re-rendered the marketing page the app launched on,
      // which is what the café saw instead of their till.
      if (!applyLaunch({ hasSession: false, restored: true })) settle()
    })()

    return () => {
      window.clearTimeout(failSafe)
      document.removeEventListener('submit', onSubmit, true)
      unsubscribe?.()
    }
  }, [])

  return null
}
