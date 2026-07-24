'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CafeOption } from '@/lib/cafe'

const ADD_CAFE_VALUE = '__add__'

export function CafeSwitcher({
  cafes,
  activeCafeId,
  canAddCafe = false,
}: {
  cafes: CafeOption[]
  activeCafeId: string
  canAddCafe?: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  if (cafes.length <= 1 && !canAddCafe) return null

  async function switchTo(cafeId: string) {
    if (cafeId === ADD_CAFE_VALUE) {
      router.push('/onboarding')
      return
    }
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
      className="w-full rounded-[var(--radius)] border border-sidebar-border bg-sidebar-elevated px-2.5 py-2 text-[13px] text-sidebar-foreground disabled:opacity-50"
    >
      {cafes.map((c) => (
        <option key={c.cafeId} value={c.cafeId}>
          {c.name}
        </option>
      ))}
      {canAddCafe && <option value={ADD_CAFE_VALUE}>+ Add café</option>}
    </select>
  )
}
