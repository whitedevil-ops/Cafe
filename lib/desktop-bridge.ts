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
 * bridge loop anyway, so there is nothing local to pair. */
export async function saveBridgeToken(token: string): Promise<void> {
  if (!isDesktopApp()) return
  try {
    await invoke('save_bridge_token', { token })
  } catch {
    // Pairing still succeeded server-side (the token exists in
    // print_bridge_tokens); only the local auto-fill failed. The café can
    // still see/copy the token from the UI that called this.
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
