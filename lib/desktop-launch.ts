// Where the desktop app should go when it opens.
//
// Split out from the bridge component purely so it can be tested. The Tauri
// window opens at "/" — the marketing homepage — which is a fine front door
// for a website and a useless one for a till, so something has to decide where
// the app actually belongs. Getting that decision wrong in either direction is
// expensive: too eager and the café can never reach the login form to switch
// accounts, too shy and the app opens on its own advertising.

/**
 * Paths the app is allowed to route itself away from. Anywhere else, the café
 * navigated there deliberately and the app should stay put.
 */
const ENTRY_PATHS = new Set(['/', '/login'])

export type LaunchState = {
  pathname: string
  search: string
  /** A live Supabase session exists in this document already. */
  hasSession: boolean
  /** A session was just restored from the file the Rust side owns. */
  restored: boolean
}

export type LaunchAction =
  | { kind: 'stay' }
  /** Same document, fetched again — the server rendered it signed-out. */
  | { kind: 'reload' }
  | { kind: 'replace'; to: string }

export function isEntryPath(pathname: string): boolean {
  return ENTRY_PATHS.has(pathname)
}

/**
 * `?next=` is attacker-controllable in principle, so only same-origin absolute
 * paths are honoured. `//evil.com` is a protocol-relative URL, not a path.
 */
export function signedInTarget(search: string): string {
  const next = new URLSearchParams(search).get('next')
  return next?.startsWith('/') && !next.startsWith('//') ? next : '/dashboard'
}

export function decideLaunch(state: LaunchState): LaunchAction {
  const { pathname, search, hasSession, restored } = state

  if (hasSession || restored) {
    if (isEntryPath(pathname)) return { kind: 'replace', to: signedInTarget(search) }
    // Signed in and somewhere real. A freshly restored session still needs the
    // document refetched, because it was rendered before the cookie existed.
    return restored ? { kind: 'reload' } : { kind: 'stay' }
  }

  // Nothing to sign in with. Only the homepage is worth leaving — a café
  // already looking at the login form does not need to be sent to it.
  return pathname === '/' ? { kind: 'replace', to: '/login' } : { kind: 'stay' }
}
