'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CafeOption } from '@/lib/cafe'

export function CafeSwitcher({
  cafes,
  activeCafeId,
}: {
  cafes: CafeOption[]
  activeCafeId: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  if (cafes.length <= 1) return null

  async function switchTo(cafeId: string) {
    if (cafeId === activeCafeId) return
    setBusy(true)
    await fetch('/api/active-cafe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cafe_id: cafeId }),
    })
    router.refresh()
    setBusy(false)
  }

  return (
    <select
      aria-label="Switch café"
      value={activeCafeId}
      disabled={busy}
      onChange={(e) => switchTo(e.target.value)}
      className="mt-2 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-2 py-1.5 text-[13px] text-foreground disabled:opacity-50"
    >
      {cafes.map((c) => (
        <option key={c.cafeId} value={c.cafeId}>
          {c.name}
        </option>
      ))}
    </select>
  )
}
