import { useSyncExternalStore } from 'react'
import { isDesktopApp } from '@/lib/is-desktop'

// "Is this desktop window still working out whether it is signed in?"
//
// The proxy decides from the cookie alone, before any script runs, and in the
// desktop webview the cookie is exactly the thing that may be missing — it does
// not survive a restart, and a reload can lose it too. When it is missing the
// server sends the window to /login, and only THEN can the page ask the Rust
// side for the stored session. Until that answer is in, the café is neither
// signed in nor signed out; it is unknown, and showing a login form in that
// moment is what made a perfectly restorable session look like a logout (and
// invited a password to be typed that was about to be unnecessary).
//
// So the login screen waits on this. It is false on the web and on the server
// render, so nothing changes outside the desktop app, and the bridge always
// lets go of it — on every outcome, with a hard timeout behind that — so a
// stuck IPC call can delay the form but never remove it.
//
// Module state rather than React state because it belongs to the document, not
// to any component: the bridge (root layout) sets it, the login form reads it.

export type AuthPhase = 'unknown' | 'ready'

/** Longest the login form will wait on the restore before showing itself anyway. */
export const AUTH_PHASE_TIMEOUT_MS = 8000

let phase: AuthPhase = 'unknown'
const listeners = new Set<() => void>()

export function setAuthPhase(next: AuthPhase): void {
  if (phase === next) return
  phase = next
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** True only inside the desktop app, and only until the bridge has settled. */
export function useDesktopAuthPending(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isDesktopApp() && phase === 'unknown',
    () => false,
  )
}
