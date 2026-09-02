// Opening a link, and copying text, in a place that is not a browser.
//
// The desktop app is a webview pointed at this same site, so almost everything
// behaves identically — but two very ordinary things do not, and both fail
// *silently*, which is the worst way for them to fail. A café taps a button,
// nothing happens, and there is nothing on screen to suggest why.
//
//   target="_blank" — the webview refuses to create a second window and does
//   not tell the page it refused. The anchor is simply inert. Every "View
//   digital bill", "Print bill" and "View bill →" link in the app is one of
//   these.
//
//   navigator.clipboard — present, but its write can be rejected outright
//   depending on focus and how the webview was built. The catch block then
//   swallows it and the toast still says "copied", so staff paste nothing.
//
// Both are fixed here, from the web side. That matters: the desktop app is a
// thin wrapper around this deployment (tauri.conf.json sets frontendDist to
// null), so a fix in this file reaches every café at their next page load,
// with no new installer and nobody rebooting a till mid-service. The Rust side
// already grants "opener:default" — allow-open-url plus the http/https/mailto
// scope — so nothing here needs a permission that isn't already shipped.

import { isDesktopApp } from '@/lib/is-desktop'

/**
 * The same global the rest of the desktop helpers use (lib/desktop-print.ts,
 * lib/desktop-bridge.ts, lib/desktop-session.ts) — `withGlobalTauri` puts it
 * on the window. Plugin commands ride the same invoke as our own, under a
 * `plugin:<name>|<command>` id.
 */
function tauriInvoke(): ((cmd: string, args: unknown) => Promise<unknown>) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    __TAURI__?: { core?: { invoke?: (c: string, a: unknown) => Promise<unknown> } }
  }
  return w.__TAURI__?.core?.invoke ?? null
}

/** Relative hrefs are fine for an anchor and useless to the OS. */
export function absoluteUrl(href: string): string {
  try {
    return new URL(href, window.location.origin).toString()
  } catch {
    return href
  }
}

/**
 * Open a URL the way the surrounding platform expects: a new browser tab on
 * the web, the café's actual default browser on the desktop.
 *
 * Returns false if it could not be opened at all, so callers can say so
 * instead of leaving someone tapping a dead button.
 */
export async function openExternal(href: string): Promise<boolean> {
  const url = absoluteUrl(href)

  const invoke = isDesktopApp() ? tauriInvoke() : null
  if (invoke) {
    try {
      // `with: null` means "whatever this machine uses for https", rather than
      // naming a browser we cannot know is installed.
      await invoke('plugin:opener|open_url', { url, with: null })
      return true
    } catch {
      // Fall through. An older build without the opener permission should
      // still get the popup-blocked path below rather than nothing at all.
    }
  }

  try {
    return window.open(url, '_blank', 'noopener,noreferrer') !== null
  } catch {
    return false
  }
}

/**
 * Copy text, and actually confirm it happened.
 *
 * The execCommand fallback is deprecated on the web and is exactly right here:
 * it is synchronous, needs no permission prompt, and works in the webview
 * where the async Clipboard API can refuse. It only runs if the modern path
 * has already failed.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Deliberate: try the old way before admitting defeat.
  }

  try {
    const el = document.createElement('textarea')
    el.value = text
    // Off-screen rather than hidden — a display:none textarea cannot be
    // selected, and an unselectable one cannot be copied.
    el.setAttribute('readonly', '')
    el.style.position = 'fixed'
    el.style.top = '-1000px'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    el.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(el)
    return ok
  } catch {
    return false
  }
}
