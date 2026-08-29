'use client'

import { createPortal } from 'react-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'

export type SearchableSelectOption = { value: string; label: string }

/**
 * A styled stand-in for a native `<select>` when the option list is long
 * enough that scrolling through it is a real chore — a native select's
 * dropdown popup is rendered by the OS/browser and can't be styled at all
 * (plain white background, default font, OS blue highlight), which is why
 * a long one looks broken next to the rest of the app's UI. This renders
 * its own popup instead, with a search box to filter by typing.
 *
 * Positioned via a portal to <body>, same reasoning as components/ops/ui.tsx's
 * ActionsMenu: a plain `absolute` child would get clipped by any scrollable
 * ancestor (this is typically opened from inside a scrollable modal), so it
 * floats independently, positioned from the trigger's own bounding rect, and
 * closes on scroll/resize rather than continuously re-tracking the trigger.
 */
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  className = '',
}: {
  value: string
  onChange: (value: string) => void
  options: SearchableSelectOption[]
  placeholder?: string
  searchPlaceholder?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const selected = options.find((o) => o.value === value)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.label.toLowerCase().includes(q))
  }, [options, query])

  function close() {
    setOpen(false)
  }

  function openMenu() {
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect) setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width })
    setQuery('')
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    // The portal doesn't exist until this render commits, so focus has to
    // wait a tick — same reasoning as ActionsMenu's scroll/resize listeners.
    const t = setTimeout(() => searchRef.current?.focus(), 0)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      clearTimeout(t)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  function pick(v: string) {
    onChange(v)
    close()
  }

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        onClick={() => (open ? close() : openMenu())}
        className={`flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[13px] text-foreground ${className}`}
      >
        <span className={`truncate ${selected ? '' : 'text-muted-foreground'}`}>{selected?.label ?? placeholder}</span>
        <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
      </button>

      {open && pos && typeof document !== 'undefined' &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={close} />
            <div
              className="fixed z-50 flex max-h-64 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface shadow-[var(--shadow-lg)]"
              style={{ top: pos.top, left: pos.left, width: Math.max(pos.width, 200) }}
            >
              <div className="flex shrink-0 items-center gap-2 border-b border-border px-2.5 py-2">
                <Search size={14} className="shrink-0 text-muted-foreground" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') close()
                    if (e.key === 'Enter' && filtered.length === 1) pick(filtered[0].value)
                  }}
                  placeholder={searchPlaceholder}
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-1">
                {filtered.length === 0 ? (
                  <p className="px-2.5 py-3 text-center text-[12.5px] text-muted-foreground">No matches.</p>
                ) : (
                  filtered.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => pick(o.value)}
                      className={`block w-full truncate rounded-[var(--radius)] px-2.5 py-2 text-left text-[13px] hover:bg-surface-subtle ${
                        o.value === value ? 'bg-primary-subtle text-primary' : 'text-foreground'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))
                )}
              </div>
            </div>
          </>,
          document.body,
        )}
    </>
  )
}
