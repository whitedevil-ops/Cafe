'use client'

import { useEffect } from 'react'

// Registers the minimal service worker (public/sw.js) once, so Chrome's
// automatic install-promotion criteria are met. Root-mounted, same reasoning
// as DesktopSessionBridge/DesktopExternalLinks — this has nothing to do with
// any one page. No-ops silently if the browser doesn't support it (e.g. the
// Tauri desktop webview) or the registration fails for any reason — this is
// additive PWA polish, never something that should be able to break a page.
export function PwaRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
  }, [])
  return null
}
