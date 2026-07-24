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
      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
        active
          ? 'border-primary bg-primary-subtle text-primary'
          : 'border-border text-muted-foreground hover:border-border-strong hover:bg-surface-subtle'
      }`}
    >
      {icon}
      {label}
      <span className="opacity-60">{count}</span>
    </button>
  )
}

// Compact horizontal quick-nav — the same category set as the vertical rail
// (single source of truth), for fast switching without reaching for the rail
// on tablet/narrow desktop, and as the only category nav on mobile.
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
