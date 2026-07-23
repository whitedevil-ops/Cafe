'use client'

import { useEffect } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

// A supplement to polling, not a replacement for it. Subscribes to Postgres
// Changes for one table, scoped to a single café via the same RLS the
// client's normal queries already go through (no new policy needed — a
// staff member's realtime channel only ever receives rows their existing
// SELECT policy allows). The caller's own setInterval poll keeps running
// as a backstop: a dropped websocket reconnects silently, but a screen that
// silently stops updating is a real failure mode a busy kitchen would not
// notice until an order sat unmade for minutes.
//
// EVERYTHING HERE IS WRAPPED IN try/catch, deliberately. This hook runs in
// the dashboard layout (via the notification bell), so it is on the render
// path of EVERY dashboard screen. A websocket that fails to open — blocked
// network, realtime disabled on the project, a duplicate channel topic —
// must degrade to "polling only", never take down the page that staff need
// to run the café. Live updates are an enhancement; the dashboard loading
// at all is not negotiable.
export function useRealtimeRefresh(
  supabase: SupabaseClient,
  table: string,
  cafeId: string,
  onChange: () => void,
) {
  useEffect(() => {
    if (!cafeId) return

    // Unique per mount, so two components subscribing to the same table for
    // the same café (e.g. the notification bell in the layout and the live
    // floor view on the page) can never collide on one channel topic.
    const topic = `${table}-${cafeId}-${Math.random().toString(36).slice(2, 9)}`
    let channel: ReturnType<SupabaseClient['channel']> | null = null

    try {
      channel = supabase
        .channel(topic)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table, filter: `cafe_id=eq.${cafeId}` },
          () => {
            try {
              onChange()
            } catch {
              // A refresh callback that throws must not kill the subscription.
            }
          },
        )
        .subscribe()
    } catch {
      // Realtime unavailable — the caller's polling interval still runs.
      channel = null
    }

    return () => {
      try {
        if (channel) void supabase.removeChannel(channel)
      } catch {
        // Nothing useful to do on teardown failure.
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onChange is expected to be stable per caller (useCallback); re-subscribing on every render would thrash the websocket.
  }, [supabase, table, cafeId])
}
