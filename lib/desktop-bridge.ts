import { isDesktopApp } from '@/lib/is-desktop'

// The print bridge's pairing token, stored on the machine — not the café's
// data. Deliberately separate from desktop-session.ts's session storage: that
// one is wiped on sign-out (whoever's shift it is), this one must survive it
// (the printer stays wired to this PC regardless of who's signed in). See
// desktop/src-tauri/src/bridge.rs for the Rust side.

async function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const w = window as unknown as {
    __TAURI__?: { core?: { invoke?: (c: string, a: unknown) => Promise<T> } }
  }
  const fn = w.__TAURI__?.core?.invoke
  if (!fn) throw new Error('not running in the desktop app')
  return fn(cmd, args)
}

/** No-op outside the desktop app — a browser tab was never going to run the
 * bridge loop anyway, so there is nothing local to pair.
 *
 * Returns whether the local save actually succeeded. This used to swallow
 * every failure and the caller always showed "paired" regardless — found
 * live: the save was silently failing (or the running bridge loop simply
 * wasn't picking up the change) and staff had no way to know pairing hadn't
 * really taken effect until a print never showed up. Pairing still succeeds
 * server-side either way (the token exists in print_bridge_tokens); only the
 * local auto-fill can fail, and now the caller finds out. */
export async function saveBridgeToken(token: string): Promise<boolean> {
  if (!isDesktopApp()) return false
  try {
    await invoke('save_bridge_token', { token })
    return true
  } catch {
    return false
  }
}

export async function loadBridgeToken(): Promise<string | null> {
  if (!isDesktopApp()) return null
  try {
    return await invoke<string | null>('load_bridge_token')
  } catch {
    return null
  }
}

export async function clearBridgeToken(): Promise<void> {
  if (!isDesktopApp()) return
  try {
    await invoke('clear_bridge_token')
  } catch {
    // ignore
  }
}
