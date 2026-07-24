'use client'

import { LayoutGrid, Flame, Sparkles } from 'lucide-react'
import { categoryIcon } from '@/lib/category-icons'

export type RailCategory = { id: string; name: string; count: number }

// Top-level (not defined inside CategoryRail's body) so React never sees a new
// component type on every render — a component defined per-render remounts
// instead of re-rendering, which is the anti-pattern the "Cannot create
// components during render" lint rule catches.
function RailRow({
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
      className={`flex w-full items-center gap-2.5 rounded-[var(--radius)] px-2.5 py-2 text-left text-[13px] font-medium transition-colors ${
        active ? 'bg-primary-subtle text-primary' : 'text-foreground hover:bg-surface-subtle'
      }`}
    >
      <span className={active ? 'text-primary' : 'text-muted-foreground'}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className={`text-[11.5px] tabular-nums ${active ? 'text-primary' : 'text-muted-foreground'}`}>{count}</span>
    </button>
  )
}

export function CategoryRail({
  categories,
  bestsellerCount,
  newCount,
  activeId,
  onSelect,
  totalCount,
}: {
  categories: RailCategory[]
  bestsellerCount: number
  newCount: number
  activeId: string
  onSelect: (id: string) => void
  totalCount: number
}) {
  return (
    <div className="flex h-full w-56 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface p-2">
      <p className="px-2.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Categories</p>
      <RailRow id="all" label="All Items" count={totalCount} icon={<LayoutGrid size={16} />} active={activeId === 'all'} onSelect={onSelect} />
      {bestsellerCount > 0 && (
        <RailRow id="__bestsellers" label="Best Sellers" count={bestsellerCount} icon={<Flame size={16} />} active={activeId === '__bestsellers'} onSelect={onSelect} />
      )}
      {newCount > 0 && (
        <RailRow id="__new" label="New Arrivals" count={newCount} icon={<Sparkles size={16} />} active={activeId === '__new'} onSelect={onSelect} />
      )}
      {categories.length > 0 && <div className="my-1.5 h-px bg-border" />}
      {categories.map((c) => {
        const Icon = categoryIcon(c.name)
        return <RailRow key={c.id} id={c.id} label={c.name} count={c.count} icon={<Icon size={16} />} active={activeId === c.id} onSelect={onSelect} />
      })}
    </div>
  )
}
