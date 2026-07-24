'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { X } from 'lucide-react'

export type ChecklistFlags = {
  menuAdded: boolean
  tablesCreated: boolean
  gstConfigured: boolean
  paymentsConfigured: boolean
  staffAdded: boolean
  qrGenerated: boolean
  testOrderPlaced: boolean
}

const ITEMS: { key: keyof ChecklistFlags; label: string; href: string }[] = [
  { key: 'menuAdded', label: 'Add your menu', href: '/dashboard/menu' },
  { key: 'tablesCreated', label: 'Create tables', href: '/dashboard/tables/manage' },
  { key: 'gstConfigured', label: 'Configure GST', href: '/dashboard/profile' },
  { key: 'paymentsConfigured', label: 'Configure payments', href: '/dashboard/profile' },
  { key: 'staffAdded', label: 'Add staff', href: '/dashboard/settings' },
  { key: 'qrGenerated', label: 'Generate QR codes', href: '/dashboard/tables/manage' },
  { key: 'testOrderPlaced', label: 'Place a test order', href: '/dashboard/pos' },
]

const dismissKey = (cafeId: string) => `kp_onboarding_dismissed_${cafeId}`

// A dismissible "finish setting up" nudge — never shown once every item is
// done, and a dismissal only sticks for the browser it was dismissed in
// (same local-preference pattern already used for the sidebar's collapsed
// state), since this is a UI convenience, not security- or resumability-
// critical state.
export function OnboardingChecklist({ cafeId, flags }: { cafeId: string; flags: ChecklistFlags }) {
  const [dismissed, setDismissed] = useState(true) // optimistic: avoid a flash before the effect reads localStorage

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDismissed(localStorage.getItem(dismissKey(cafeId)) === '1')
  }, [cafeId])

  const done = ITEMS.filter((i) => flags[i.key]).length
  const total = ITEMS.length
  if (dismissed || done === total) return null

  function dismiss() {
    localStorage.setItem(dismissKey(cafeId), '1')
    setDismissed(true)
  }

  return (
    <div className="mt-6 rounded-xl border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-foreground">Finish setting up KhaoPiyo</h2>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">{done} / {total} complete</p>
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-surface-subtle"
        >
          <X size={16} />
        </button>
      </div>

      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-subtle">
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${(done / total) * 100}%` }} />
      </div>

      <ul className="mt-4 grid gap-1.5 sm:grid-cols-2">
        {ITEMS.map((item) => {
          const complete = flags[item.key]
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                className={`flex items-center gap-2 rounded-[var(--radius)] px-2.5 py-1.5 text-[13px] transition-colors hover:bg-surface-subtle ${
                  complete ? 'text-muted-foreground line-through' : 'text-foreground'
                }`}
              >
                <span
                  aria-hidden
                  className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[10px] ${
                    complete ? 'border-success bg-success text-white' : 'border-border-strong text-transparent'
                  }`}
                >
                  ✓
                </span>
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
