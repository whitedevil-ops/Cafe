'use client'

import { LayoutGrid } from 'lucide-react'

export type PosCategory = { id: string; name: string; count: number }

export function CategoryTabs({
  categories,
  activeId,
  onSelect,
  totalCount,
}: {
  categories: PosCategory[]
  activeId: string | 'all'
  onSelect: (id: string | 'all') => void
  totalCount: number
}) {
  const Tab = ({
    id,
    label,
    count,
    icon,
  }: {
    id: string | 'all'
    label: string
    count: number
    icon?: React.ReactNode
  }) => (
    <button
      onClick={() => onSelect(id)}
      className={`flex min-w-[84px] shrink-0 flex-col items-center gap-1.5 rounded-[var(--radius)] border px-4 py-2.5 text-center transition-colors ${
        activeId === id
          ? 'border-primary bg-primary-subtle text-primary'
          : 'border-border bg-surface text-muted-foreground hover:border-border-strong'
      }`}
    >
      {icon ?? <span className="h-[18px]" />}
      <span className="text-[12px] font-medium leading-none">{label}</span>
      <span className="text-[10.5px] leading-none opacity-70">{count} items</span>
    </button>
  )

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      <Tab id="all" label="All" count={totalCount} icon={<LayoutGrid size={16} />} />
      {categories.map((c) => (
        <Tab key={c.id} id={c.id} label={c.name} count={c.count} />
      ))}
    </div>
  )
}
