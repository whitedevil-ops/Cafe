'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/utils/supabase/client'
import { deviceLabel } from '@/lib/device-label'
import { isDesktopApp } from '@/lib/is-desktop'

// Records "last active" and "last device" for the signed-in user, so the
// operator console can answer "when did this café last actually use the
// product, and on what" without guessing from order timestamps.
//
// Client-side rather than in the server layout for one reason that matters:
// the Tauri webview sends an ordinary Chrome/Safari user agent, so a server
// cannot tell the desktop till from someone's laptop. isDesktopApp() can, and
// only runs here. "Windows · KhaoPiyo app" vs "Windows · Chrome" is exactly
// the distinction worth having.
//
// Fire-and-forget by design: this is telemetry about the session, and it must
// never delay a page or surface an error to a café mid-service. The RPC is
// throttled to one write per 5 minutes server-side (migration 0128), so
// mounting on every dashboard navigation is cheap.

export function UserActivityTracker() {
  const sent = useRef(false)

  useEffect(() => {
    if (sent.current) return
    sent.current = true

    void createClient()
      .rpc('touch_user_activity', {
        p_device: deviceLabel(navigator.userAgent, isDesktopApp()),
      })
      .then(undefined, () => {
        // Deliberately silent. A café does not need to know that an activity
        // ping failed, and nothing downstream depends on it.
      })
  }, [])

  return null
}
