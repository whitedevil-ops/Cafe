'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/utils/supabase/client'
import { isDesktopApp } from '@/lib/is-desktop'
import { saveStoredSession, loadStoredSession, clearStoredSession } from '@/lib/desktop-session'
import { decideLaunch, type LaunchState } from '@/lib/desktop-launch'

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
 * Set once the app has made its one automatic navigation for this run, and
 * cleared when the app closes.
 *
 * It has to be one navigation, not one per situation. If a restored cookie
 * somehow does not reach the server, /dashboard bounces back to /login, which
 * would send it to /dashboard again — an endless loop on the café's till,
 * which is far worse than showing a login form.
 */
const ROUTED_KEY = 'kp:desktop:launch-routed'

/** True the first time only. Guards against the bounce loop described above. */
function claimNavigation(): boolean {
  try {
    if (sessionStorage.getItem(ROUTED_KEY)) return false
    sessionStorage.setItem(ROUTED_KEY, '1')
    return true
  } catch {
    // No sessionStorage means no way to prove this is the first attempt, so
    // don't risk it.
    return false
  }
}

/** Runs the decision from lib/desktop-launch against the real window. */
function applyLaunch(state: Omit<LaunchState, 'pathname' | 'search'>): void {
  const action = decideLaunch({
    ...state,
    pathname: window.location.pathname,
    search: window.location.search,
  })
  if (action.kind === 'stay') return
  if (!claimNavigation()) return
  if (action.kind === 'reload') window.location.reload()
  else window.location.replace(action.to)
}

export function DesktopSessionBridge() {
  const ran = useRef(false)

  useEffect(() => {
    if (!isDesktopApp() || ran.current) return
    ran.current = true

    const supabase = createClient()
    let unsubscribe: (() => void) | undefined

    void (async () => {
      // Save on every sign-in and every silent refresh. Storing only at login
      // would leave a token that quietly ages out, and the café would be
      // signed out days later for no visible reason.
      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT' || !session) {
          void clearStoredSession()
          return
        }
        // saveStoredSession is a no-op when "Keep me signed in" is off, so the
        // café's choice is honoured without this needing to know about it.
        void saveStoredSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        })
      })
      unsubscribe = () => data.subscription.unsubscribe()

      // Already signed in — never overwrite it, that would log the café out of
      // the account they just signed into. But if the app is parked on the
      // marketing site, take it to the till.
      const { data: current } = await supabase.auth.getSession()
      if (current.session) {
        applyLaunch({ hasSession: true, restored: false })
        return
      }

      const stored = await loadStoredSession()
      if (!stored) {
        // Nothing to restore. Still worth leaving the homepage: an app that
        // opens on its own marketing page looks broken, and the café has to
        // hunt for "Log in" before it can do anything.
        applyLaunch({ hasSession: false, restored: false })
        return
      }

      const { error } = await supabase.auth.setSession({
        access_token: stored.access_token,
        refresh_token: stored.refresh_token,
      })
      if (error) {
        // Revoked or expired past recovery — drop it rather than retrying this
        // on every launch forever.
        void clearStoredSession()
        applyLaunch({ hasSession: false, restored: false })
        return
      }

      // setSession writes the auth cookie in the page, but the server rendered
      // this document before it existed, so it has to be fetched again either
      // way. Going to the dashboard rather than reloading is the whole point:
      // a reload here just re-rendered the marketing page the app launched on,
      // which is what the café saw instead of their till.
      applyLaunch({ hasSession: false, restored: true })
    })()

    return () => unsubscribe?.()
  }, [])

  return null
}
