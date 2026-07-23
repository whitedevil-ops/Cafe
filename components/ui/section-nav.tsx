'use client'

import type { ReactNode } from 'react'

export type SectionItem = {
  id: string
  label: string
  icon?: ReactNode
}

// Secondary navigation for settings-style pages. Vertical rail on desktop,
// a horizontal scroller on mobile (never a native <select> — a settings page
// should show its sections, not hide them behind a dropdown).
export function SectionNav({
  items,
  active,
  onChange,
}: {
  items: SectionItem[]
  active: string
  onChange: (id: string) => void
}) {
  return (
    <>
      {/* Mobile: horizontal chip scroller */}
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 lg:hidden">
        {items.map((it) => (
          <button
            key={it.id}
            onClick={() => onChange(it.id)}
            aria-current={active === it.id}
            className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-medium transition-colors ${
              active === it.id
                ? 'border-primary bg-primary-subtle text-primary'
                : 'border-border-strong text-muted-foreground hover:bg-surface-subtle'
            }`}
          >
            {it.icon}
            {it.label}
          </button>
        ))}
      </div>

      {/* Desktop: vertical rail */}
      <nav className="hidden lg:block">
        <ul className="space-y-0.5">
          {items.map((it) => (
            <li key={it.id}>
              <button
                onClick={() => onChange(it.id)}
                aria-current={active === it.id}
                className={`flex w-full items-center gap-2.5 rounded-[var(--radius)] px-3 py-2 text-left text-[13.5px] font-medium transition-colors ${
                  active === it.id
                    ? 'bg-primary-subtle text-primary'
                    : 'text-muted-foreground hover:bg-surface-subtle hover:text-foreground'
                }`}
              >
                <span className={active === it.id ? 'text-primary' : 'text-muted-foreground'}>{it.icon}</span>
                {it.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </>
  )
}
