import { isDesktopApp } from '@/lib/is-desktop'

// "Keep me signed in", and the storage it controls.
//
// Two things live together here because they are one decision. In the desktop
// app the webview does not persist cookies at all, so staying signed in means
// keeping a refresh token in a file the app owns. That is a real choice about
// a real token on the café's PC, so it is the café's to make rather than
// something implied — and this is the switch.
//
// Defaults on: a till that asks for a password every morning is the thing
// being fixed. Anyone who wants otherwise unticks it once and it is remembered.

const KEEP_KEY = 'kp:keep-signed-in'

export type StoredSession = { access_token: string; refresh_token: string }

export function keepSignedIn(): boolean {
  if (typeof window === 'undefined') return false
  try {
    // Absent means never chosen, which is the default rather than "off".
    return localStorage.getItem(KEEP_KEY) !== '0'
  } catch {
    return false
  }
}

export function setKeepSignedIn(on: boolean): void {
  try {
    localStorage.setItem(KEEP_KEY, on ? '1' : '0')
  } catch {
    // Storage unavailable — the preference just won't survive, which is the
    // same as leaving it at the default.
  }
}

async function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const w = window as unknown as {
    __TAURI__?: { core?: { invoke?: (c: string, a: unknown) => Promise<T> } }
  }
  const fn = w.__TAURI__?.core?.invoke
  if (!fn) throw new Error('not running in the desktop app')
  return fn(cmd, args)
}

/** No-op in a browser, where cookies already do this job. */
export async function saveStoredSession(session: StoredSession): Promise<void> {
  if (!isDesktopApp() || !keepSignedIn()) return
  try {
    await invoke('save_session', { value: JSON.stringify(session) })
  } catch {
    // Nothing to do about it, and nothing that should interrupt the café.
  }
}

export async function loadStoredSession(): Promise<StoredSession | null> {
  if (!isDesktopApp() || !keepSignedIn()) return null
  try {
    const raw = await invoke<string | null>('load_session')
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredSession
    return parsed?.refresh_token ? parsed : null
  } catch {
    return null
  }
}

export async function clearStoredSession(): Promise<void> {
  if (!isDesktopApp()) return
  try {
    await invoke('clear_session')
  } catch {
    // ignore
  }
}

/**
 * Whether the login page should leave the existing session alone.
 *
 * /login signs out on arrival so switching accounts does not depend on finding
 * Sign out first. In the desktop app that same effect fires on every launch —
 * the app opens, lands on /login, and destroys the session that was about to
 * be restored. When a stored session exists and the café asked to stay signed
 * in, arriving at /login is not a request to sign out; it is the app starting.
 */
export async function shouldSkipLoginSignOut(): Promise<boolean> {
  return (await loadStoredSession()) !== null
}
