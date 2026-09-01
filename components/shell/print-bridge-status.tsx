'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { PrinterCheck, PrinterX } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { formatDateTime } from '@/lib/datetime'

/**
 * How long after a bridge's last check-in it still counts as connected. The
 * ONE definition of "connected" in the browser — imported by the settings
 * panel too, so the header and Settings → KOT printing can never disagree
 * about whether the same bridge is up. Matches the `interval '2 minutes'`
 * printer_health() uses server-side (migration 0027).
 */
export const BRIDGE_ONLINE_MS = 120000

type Token = { last_seen_at: string | null }

/**
 * Always-visible answer to "is auto-printing alive right now?", in the
 * dashboard header, on every screen.
 *
 * WHY THIS EXISTS: the only previous signal was a per-printer dot inside
 * Settings → KOT printing — a screen nobody has open during service. A bridge
 * that stopped polling (or one that never once connected) looked exactly like
 * a quiet evening, and a real café ran a full day printing nothing before
 * anyone noticed. Silent is the failure mode to design against here.
 *
 * Deliberately NOT gated on isDesktopApp(): a manager checking from a phone
 * needs "printing is down at the counter" just as much as the till does.
 *
 * Shows nothing at all unless the café has printing on AND a bridge paired —
 * a café that never set printing up must not get a red badge for a feature it
 * doesn't use.
 */
export function PrintBridgeStatus({
  cafeId,
  timezone,
  enabled,
}: {
  cafeId: string
  timezone: string
  /** cafes.kot_printing_enabled — see app/dashboard/layout.tsx. */
  enabled: boolean
}) {
  const supabase = useMemo(() => createClient(), [])
  // null until the first read lands, so a café with no bridge and a café we
  // haven't asked about yet both render nothing rather than flashing a badge.
  const [tokens, setTokens] = useState<Token[] | null>(null)
  // Refreshed by the poll below, never Date.now() read during render — that
  // would make this component impure (same reasoning as kot-printing-panel).
  const [now, setNow] = useState(() => Date.now())

  // Returns the rows instead of setting state itself, so the effect below
  // owns the decision to apply them and can drop a response that lands after
  // unmount.
  const load = useCallback(async () => {
    const { data } = await supabase
      .from('print_bridge_tokens')
      .select('last_seen_at')
      .eq('cafe_id', cafeId)
      .is('revoked_at', null)
    return (data ?? null) as Token[] | null
  }, [supabase, cafeId])

  // Same 20s cadence as the settings panel's poll, and only while printing is
  // on — an off café shouldn't generate traffic from every dashboard screen.
  useEffect(() => {
    if (!enabled) return
    let alive = true
    async function poll() {
      const rows = await load()
      if (!alive) return
      // The clock advances even when the fetch failed: if this browser can't
      // reach Supabase, the last_seen_at already in hand ages past
      // BRIDGE_ONLINE_MS and the indicator flips itself to offline, rather
      // than sitting reassuringly green on data that stopped updating. A
      // broken poll must look broken — that is the whole point of this thing.
      setNow(Date.now())
      if (rows) setTokens(rows)
    }
    void poll()
    const id = setInterval(poll, 20000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [enabled, load])

  if (!enabled || !tokens || tokens.length === 0) return null

  // A café can pair more than one machine; any one of them checking in means
  // tickets are getting out, so the freshest check-in decides.
  const lastSeen = tokens
    .map((t) => t.last_seen_at)
    .filter((s): s is string => Boolean(s))
    .sort()
    .at(-1)
  const online = Boolean(lastSeen && now - new Date(lastSeen).getTime() < BRIDGE_ONLINE_MS)

  const detail = online
    ? `Auto-printing is working. Counter app last checked in ${formatDateTime(lastSeen, timezone)}.`
    : lastSeen
      ? `Tickets are NOT printing automatically. The counter computer last checked in ${formatDateTime(lastSeen, timezone)} — check it is on and the KhaoPiyo app is open. Orders still reach the Kitchen screen.`
      : 'Tickets have never printed automatically. Open the KhaoPiyo app on the counter computer and pair it in Settings → KOT printing. Orders still reach the Kitchen screen.'

  return (
    <Link
      href="/dashboard/settings"
      title={detail}
      aria-label={detail}
      className="flex h-10 shrink-0 items-center gap-1.5 rounded-[var(--radius)] px-2 text-[12.5px] font-medium hover:bg-surface-subtle"
    >
      {online ? (
        <PrinterCheck size={16} className="shrink-0 text-success" />
      ) : (
        <PrinterX size={16} className="shrink-0 text-destructive" />
      )}
      {/* The healthy label is reassurance and can give up its space on a
          phone; the broken one is the whole point of this component, so it
          stays visible at every width. */}
      <span className={online ? 'hidden text-muted-foreground sm:inline' : 'text-destructive'}>
        {online ? 'Printing on' : 'Printing offline'}
      </span>
    </Link>
  )
}
