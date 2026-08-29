'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CafeOption } from '@/lib/cafe'

// Shown on the suspended-account dashboard blockers (app/dashboard/layout.tsx)
// when the owner has more than one café. Landing on this screen doesn't mean
// every café they own is unusable — getCurrentCafe() only ever resolves ONE
// café per session, and an owner whose other café is perfectly fine still
// needs a way to reach it without signing out entirely. /api/active-cafe only
// checks membership, never status, so switching away from a blocked café
// always works regardless of why this one is blocked.
export function SwitchAwayHint({ cafes, currentCafeId }: { cafes: CafeOption[]; currentCafeId: string }) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const others = cafes.filter((c) => c.cafeId !== currentCafeId)
  if (others.length === 0) return null

  async function switchTo(cafeId: string) {
    setBusyId(cafeId)
    await fetch('/api/active-cafe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cafe_id: cafeId }),
    })
    router.refresh()
  }

  return (
    <div className="mt-6 border-t border-border pt-5">
      <p className="text-[13px] text-muted-foreground">This is just one of your cafés — the others aren&apos;t affected.</p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {others.map((c) => (
          <button
            key={c.cafeId}
            onClick={() => switchTo(c.cafeId)}
            disabled={busyId !== null}
            className="rounded-full border border-border-strong px-3.5 py-1.5 text-[13px] font-medium text-foreground hover:bg-surface-subtle disabled:opacity-50"
          >
            {busyId === c.cafeId ? 'Switching…' : `Go to ${c.name}`}
          </button>
        ))}
      </div>
    </div>
  )
}
