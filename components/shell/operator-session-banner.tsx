'use client'

import { useEffect, useState } from 'react'
import type { OperatorSession } from '@/lib/cafe'

function remaining(expiresAt: string, now: number): string {
  const ms = new Date(expiresAt).getTime() - now
  if (ms <= 0) return 'expired'
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}m left`
  return `${Math.floor(mins / 60)}h ${mins % 60}m left`
}

/**
 * Permanent, unmissable marker that the dashboard below belongs to someone
 * else. The whole safety argument for operator sessions (migration 0134) is
 * that an operator always knows whose café they are in, so this is not
 * decoration — it is the feature. Deliberately not dismissible.
 */
export function OperatorSessionBanner({
  cafeName,
  session,
}: {
  cafeName: string
  session: OperatorSession
}) {
  const [now, setNow] = useState(() => Date.now())
  const [ending, setEnding] = useState(false)

  // Ticks once a minute, not once a second: the label only ever shows whole
  // minutes, so a faster timer would re-render the whole shell for nothing.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const expired = new Date(session.expiresAt).getTime() <= now

  async function end() {
    setEnding(true)
    try {
      await fetch('/api/ops/cafe-session', { method: 'DELETE' })
    } catch {
      // Even if the call fails the session still expires on its own, and the
      // operator should not be trapped on this screen — fall through to the
      // console either way.
    }
    // A full document navigation, not router.push: the café context lives in
    // server components that have already rendered, and only a fresh request
    // re-runs getCurrentCafe() now that the session is gone.
    window.location.href = '/ops/cafes'
  }

  return (
    <div
      role="status"
      className="sticky top-0 z-50 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-500/30 bg-amber-950 px-4 py-2 text-[13px] text-amber-100"
    >
      <span className="inline-flex items-center gap-1.5 font-medium">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
        Operator session
      </span>
      <span className="min-w-0 truncate text-amber-200/80">
        You are inside <span className="font-medium text-amber-100">{cafeName}</span> — changes you
        make are real.
      </span>
      <span className="ml-auto flex items-center gap-3">
        <span className={expired ? 'text-red-300' : 'text-amber-200/70'}>
          {expired ? 'Session expired' : remaining(session.expiresAt, now)}
        </span>
        <button
          onClick={end}
          disabled={ending}
          className="min-h-8 rounded-md border border-amber-400/40 px-2.5 py-1 font-medium text-amber-100 transition-colors hover:bg-amber-400/15 disabled:opacity-60"
        >
          {ending ? 'Ending…' : 'End session'}
        </button>
      </span>
    </div>
  )
}
