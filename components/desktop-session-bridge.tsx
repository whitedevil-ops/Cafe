'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/utils/supabase/client'
import { isDesktopApp } from '@/lib/is-desktop'

// Keeps the desktop app signed in across restarts.
//
// The webview does not persist cookies — not late, not partially: it never
// opens the cookie database at all, while writing cache and local storage to
// the same profile quite happily. So the session is handed to the Rust side,
// which writes it to a file the webview has no say over, and handed back on
// the next launch.
//
// Does nothing at all in a browser, where cookies work and this would be a
// second source of truth fighting the first.

type Stored = { access_token: string; refresh_token: string }

/** Cleared when the app closes, so the next launch may restore again. */
const RELOADED_KEY = 'kp:desktop:session-restored'

async function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const w = window as unknown as {
    __TAURI__?: { core?: { invoke?: (c: string, a: unknown) => Promise<T> } }
  }
  const fn = w.__TAURI__?.core?.invoke
  if (!fn) throw new Error('not running in the desktop app')
  return fn(cmd, args)
}

export function DesktopSessionBridge() {
  const restored = useRef(false)

  useEffect(() => {
    if (!isDesktopApp() || restored.current) return
    restored.current = true

    const supabase = createClient()
    let unsubscribe: (() => void) | undefined

    void (async () => {
      // Save on every sign-in and every silent refresh. Storing only at login
      // would leave a token that quietly ages out, and the café would be
      // signed out days later for no visible reason.
      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT' || !session) {
          void invoke('clear_session').catch(() => {})
          return
        }
        const payload: Stored = {
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        }
        void invoke('save_session', { value: JSON.stringify(payload) }).catch(() => {})
      })
      unsubscribe = () => data.subscription.unsubscribe()

      // Restore only when the webview genuinely has nothing. If a session is
      // already live, writing over it would log the café out of the account
      // they just signed into.
      const { data: current } = await supabase.auth.getSession()
      if (current.session) return

      let raw: string | null = null
      try {
        raw = await invoke<string | null>('load_session')
      } catch {
        return
      }
      if (!raw) return

      let stored: Stored
      try {
        stored = JSON.parse(raw) as Stored
      } catch {
        void invoke('clear_session').catch(() => {})
        return
      }
      if (!stored?.refresh_token) return

      const { error } = await supabase.auth.setSession({
        access_token: stored.access_token,
        refresh_token: stored.refresh_token,
      })
      if (error) {
        // Revoked or expired past recovery — drop it rather than retrying
        // this on every launch forever.
        void invoke('clear_session').catch(() => {})
        return
      }

      // setSession writes the auth cookie in the page, but the server rendered
      // this request before it existed. A reload is what makes the dashboard
      // appear instead of the login form. location.reload rather than
      // router.refresh because the whole document was rendered signed-out.
      //
      // Reload at most once. If the restored cookie somehow does not reach the
      // server, the page comes back signed-out and would ask to restore again
      // — an endless reload loop on the café's till, which is far worse than
      // showing a login form.
      try {
        if (sessionStorage.getItem(RELOADED_KEY)) return
        sessionStorage.setItem(RELOADED_KEY, '1')
      } catch {
        // No sessionStorage means no way to prove this is the first attempt,
        // so don't risk the loop.
        return
      }
      window.location.reload()
    })()

    return () => unsubscribe?.()
  }, [])

  return null
}
