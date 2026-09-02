'use client'

import { useEffect } from 'react'
import { isDesktopApp } from '@/lib/is-desktop'
import { openExternal } from '@/lib/desktop-open'

// Makes every target="_blank" link in the app work inside the desktop app.
//
// There are a dozen or so of them — View digital bill, Print bill, View bill →,
// the QR menu preview, the customer's own order link — and in the webview all
// of them are dead. Not slow, not erroring: dead. The click lands, the webview
// declines to open a second window, and no event reaches the page, so nothing
// can even report the failure. That is what a café means when they say "the
// buttons work on the website but not in the software".
//
// Fixed in one place, on purpose. The alternative is an onClick on every
// anchor, which fixes today's twelve and misses the thirteenth someone adds
// next month. A café should never again find a dead button because a new link
// forgot a handler it had no way to know about.
//
// Inert in a browser: the listener is only attached inside the desktop app,
// where a plain _blank click has no working behaviour to interfere with.
export function DesktopExternalLinks() {
  useEffect(() => {
    if (!isDesktopApp()) return

    function onClick(e: MouseEvent) {
      // Leave anything the user modified alone — a middle-click or ctrl-click
      // means they asked for something specific, and a handled left-click is
      // already someone else's.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return

      const anchor = (e.target as Element | null)?.closest?.('a[target="_blank"]') as HTMLAnchorElement | null
      if (!anchor) return

      const href = anchor.getAttribute('href')
      // Downloads and mailto:/tel: are the OS's business either way, and
      // "#"-only anchors are buttons wearing an anchor's clothes.
      if (!href || href.startsWith('#') || anchor.hasAttribute('download')) return

      e.preventDefault()
      void openExternal(href)
    }

    // Capture phase, so this runs before any framework handler that might
    // stop propagation on its way past.
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  return null
}
