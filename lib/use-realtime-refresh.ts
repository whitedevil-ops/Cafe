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
export function useRealtimeRefresh(
  supabase: SupabaseClient,
  table: string,
  cafeId: string,
  onChange: () => void,
) {
  useEffect(() => {
    const channel = supabase
      .channel(`${table}-${cafeId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `cafe_id=eq.${cafeId}` },
        onChange,
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onChange is expected to be stable per caller (useCallback); re-subscribing on every render would thrash the websocket.
  }, [supabase, table, cafeId])
}
