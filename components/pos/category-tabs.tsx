'use client'

import { LayoutGrid, Flame, Sparkles } from 'lucide-react'
import { categoryIcon } from '@/lib/category-icons'

export type PosCategory = { id: string; name: string; count: number }

// Top-level (not defined inside CategoryTabs' body) — a component defined
// per-render would remount instead of re-rendering on every keystroke/state
// change, which is the anti-pattern the "Cannot create components during
// render" lint rule catches.
function Tab({
  id,
  label,
  count,
  icon,
  active,
  onSelect,
}: {
  id: string
  label: string
  count: number
  icon: React.ReactNode
  active: boolean
  onSelect: (id: string) => void
}) {
  return (
    <button
      onClick={() => onSelect(id)}
      className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition-colors ${
        active
          ? 'border-primary bg-primary text-primary-foreground shadow-[var(--shadow-sm)]'
          : 'border-border bg-surface text-muted-foreground hover:border-border-strong hover:bg-surface-subtle'
      }`}
    >
      {icon}
      {label}
      <span className={active ? 'opacity-80' : 'opacity-60'}>{count}</span>
    </button>
  )
}

// The single category nav for POS — horizontal at every breakpoint. There is
// no permanent category sidebar; when the list overflows the strip, it just
// scrolls horizontally.
export function CategoryTabs({
  categories,
  bestsellerCount,
  newCount,
  activeId,
  onSelect,
  totalCount,
}: {
  categories: PosCategory[]
  bestsellerCount: number
  newCount: number
  activeId: string
  onSelect: (id: string) => void
  totalCount: number
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-0.5">
      <Tab id="all" label="All Items" count={totalCount} icon={<LayoutGrid size={14} />} active={activeId === 'all'} onSelect={onSelect} />
      {bestsellerCount > 0 && (
        <Tab id="__bestsellers" label="Best Sellers" count={bestsellerCount} icon={<Flame size={14} />} active={activeId === '__bestsellers'} onSelect={onSelect} />
      )}
      {newCount > 0 && (
        <Tab id="__new" label="New" count={newCount} icon={<Sparkles size={14} />} active={activeId === '__new'} onSelect={onSelect} />
      )}
      {categories.map((c) => {
        const Icon = categoryIcon(c.name)
        return <Tab key={c.id} id={c.id} label={c.name} count={c.count} icon={<Icon size={14} />} active={activeId === c.id} onSelect={onSelect} />
      })}
    </div>
  )
}
