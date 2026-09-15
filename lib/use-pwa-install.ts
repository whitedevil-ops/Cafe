'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { isDesktopApp } from '@/lib/is-desktop'

// The event Chromium fires when it decides a page is installable. Not in
// lib.dom.d.ts (still non-standard), so it's typed by hand here rather than
// pulled in from a package.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

type Platform = 'android' | 'ios' | null

const DISMISS_KEY = 'kp_pwa_install_dismissed_until'
const INSTALLED_KEY = 'kp_pwa_installed'
const DISMISS_DAYS = 14

function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false
  const nav = window.navigator as Navigator & { standalone?: boolean }
  // display-mode:standalone covers Android/desktop PWAs; iOS Safari never
  // matches that media feature even when launched from the home screen —
  // it exposes its own separate navigator.standalone boolean instead.
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
}

function isTouchPrimaryNarrowViewport(): boolean {
  if (typeof window === 'undefined') return false
  // Two independent signals, both required — pointer type alone would also
  // match a rare touchscreen laptop running desktop Chrome; width alone
  // would match a narrowed desktop window. Together they reliably mean
  // "a phone or tablet", not "the user-agent string contains a phone name".
  return window.matchMedia('(pointer: coarse)').matches && window.matchMedia('(max-width: 900px)').matches
}

function detectPlatform(): Platform {
  if (typeof window === 'undefined') return null
  const ua = window.navigator.userAgent
  const isIPhoneOrIpadOS12 = /iPad|iPhone|iPod/.test(ua)
  // iPadOS 13+ reports its UA as a plain "Macintosh" with touch support —
  // the one case touch/viewport detection alone can't tell apart from an
  // actual Mac, so this still needs a UA check. There is no way around it:
  // Apple exposes no feature-detectable "can this page be installed" API on
  // iOS at all, unlike beforeinstallprompt on Chromium.
  const isIPadOS13Plus = ua.includes('Macintosh') && navigator.maxTouchPoints > 1
  if (isIPhoneOrIpadOS12 || isIPadOS13Plus) return 'ios'
  // Chromium-family UA token, broad on purpose (Chrome, Edge, Samsung
  // Internet, Brave, etc. on Android all carry it) — but this only decides
  // WHICH instructional copy a mobile visitor sees; it never gates whether
  // the Android install button actually works, since that always depends
  // on the real beforeinstallprompt event actually having fired.
  if (/Android/.test(ua)) return 'android'
  return null
}

export function usePwaInstall() {
  const [ready, setReady] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [platform, setPlatform] = useState<Platform>(null)
  const [installed, setInstalled] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [canPromptAndroid, setCanPromptAndroid] = useState(false)
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    // Everything here needs window/localStorage, which don't exist during
    // SSR — this has to start false/null and correct itself post-mount, or
    // the server and first client render would disagree (a real hydration
    // mismatch), not just trip the lint rule.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMobile(isTouchPrimaryNarrowViewport())
    setPlatform(detectPlatform())
    setInstalled(isStandaloneDisplay() || localStorage.getItem(INSTALLED_KEY) === '1')

    const dismissedUntil = Number(localStorage.getItem(DISMISS_KEY) ?? 0)
    setDismissed(Date.now() < dismissedUntil)

    function onBeforeInstallPrompt(e: Event) {
      // Stops Chrome's own default mini-infobar so only this UI offers to
      // install — the deferred event is what install() below replays.
      e.preventDefault()
      deferredPrompt.current = e as BeforeInstallPromptEvent
      setCanPromptAndroid(true)
    }
    function onAppInstalled() {
      localStorage.setItem(INSTALLED_KEY, '1')
      setInstalled(true)
      deferredPrompt.current = null
      setCanPromptAndroid(false)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)
    setReady(true)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [])

  const install = useCallback(async () => {
    const evt = deferredPrompt.current
    if (!evt) return 'unavailable' as const
    await evt.prompt()
    const { outcome } = await evt.userChoice
    deferredPrompt.current = null
    setCanPromptAndroid(false)
    if (outcome === 'accepted') {
      localStorage.setItem(INSTALLED_KEY, '1')
      setInstalled(true)
    }
    return outcome
  }, [])

  const dismiss = useCallback(() => {
    const until = Date.now() + DISMISS_DAYS * 24 * 60 * 60 * 1000
    localStorage.setItem(DISMISS_KEY, String(until))
    setDismissed(true)
  }, [])

  // Android needs the real event to have actually fired (genuine feature
  // detection — never assume support just because the UA looks right).
  // iOS has no such event; showing its instructions only needs platform
  // detection, since there is nothing to feature-detect against.
  const eligible =
    ready && isMobile && !isDesktopApp() && !installed && !dismissed &&
    ((platform === 'android' && canPromptAndroid) || platform === 'ios')

  return { show: eligible, platform, install, dismiss }
}
