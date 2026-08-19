'use client'

import { useState } from 'react'
import { LayoutGrid, Flame, Sparkles, Package, Plus } from 'lucide-react'
import { categoryEmoji, categoryDisplayName } from '@/lib/category-icons'

export type PosCategory = { id: string; name: string; count: number }

// A muted, warm-toned badge color per category — purely decorative (the
// "Amber Warm" palette's own accent scales, not raw neon Tailwind colors),
// picked deterministically from the category's name so it's stable across
// reloads without needing to store a color anywhere. Icon *resolution*
// (lib/category-icons.ts) is untouched; this only adds a background chip
// behind whatever icon it already returns. Kept subtle (10% tint, small
// 28px container) — a support for the name, not a competing visual.
const TONES = [
  'bg-primary-subtle text-primary',
  'bg-accent/10 text-accent',
  'bg-success/10 text-success',
  'bg-info/10 text-info',
  'bg-special/10 text-special',
  'bg-warning/10 text-warning',
]
function toneFor(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return TONES[h % TONES.length]
}

// Top-level (not defined inside CategoryTabs' body) — a component defined
// per-render would remount instead of re-rendering on every keystroke/state
// change, which is the anti-pattern the "Cannot create components during
// render" lint rule catches.
function Row({
  id,
  label,
  count,
  icon,
  tone,
  active,
  onSelect,
}: {
  id: string
  label: string
  count: number
  icon: React.ReactNode
  tone: string
  active: boolean
  onSelect: (id: string) => void
}) {
  return (
    <button
      onClick={() => onSelect(id)}
      className={`flex h-[52px] w-full shrink-0 items-center gap-1.5 rounded-[var(--radius)] px-2 text-left text-[13.5px] font-medium transition-colors ${
        active
          ? 'bg-primary text-primary-foreground shadow-[var(--shadow-sm)]'
          : 'text-foreground hover:bg-surface-subtle'
      }`}
    >
      <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-[var(--radius-sm)] ${active ? 'bg-white/20 text-primary-foreground' : tone}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className={`shrink-0 text-[11.5px] tabular-nums ${active ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{count}</span>
    </button>
  )
}

// The vertical category rail — sits between the main sidebar and the food
// grid, sticky within the POS content area (the parent column scrolls
// independently; only the list in the middle scrolls internally if a café
// has enough categories to overflow — "All Items" and "+ Add Category" stay
// pinned top/bottom). Fully controlled by the parent for selection state;
// onAddCategory is the one piece of real write behavior, and it's optional —
// pass it only for an owner/manager (menu_categories RLS already requires
// that role for inserts; the prop being present/absent here is just the UI
// staying out of an unauthorized staff member's way, not the real gate).
export function CategoryTabs({
  categories,
  bestsellerCount,
  newCount,
  comboCount = 0,
  activeId,
  onSelect,
  onAddCategory,
  addingCategory,
  totalCount,
}: {
  categories: PosCategory[]
  bestsellerCount: number
  newCount: number
  comboCount?: number
  activeId: string
  onSelect: (id: string) => void
  onAddCategory?: (name: string) => void
  addingCategory?: boolean
  totalCount: number
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  function submit() {
    if (!name.trim()) return
    onAddCategory?.(name)
    setName('')
    setAdding(false)
  }

  return (
    <div className="flex h-full flex-col p-1.5">
      <Row id="all" label="All Items" count={totalCount} icon={<LayoutGrid size={14} />} tone="bg-primary-subtle text-primary" active={activeId === 'all'} onSelect={onSelect} />
      <div className="mt-1 flex-1 space-y-0.5 overflow-y-auto">
        {comboCount > 0 && (
          <Row id="__combos" label="Combos" count={comboCount} icon={<Package size={14} />} tone="bg-special/10 text-special" active={activeId === '__combos'} onSelect={onSelect} />
        )}
        {bestsellerCount > 0 && (
          <Row id="__bestsellers" label="Best Sellers" count={bestsellerCount} icon={<Flame size={14} />} tone="bg-warning/10 text-warning" active={activeId === '__bestsellers'} onSelect={onSelect} />
        )}
        {newCount > 0 && (
          <Row id="__new" label="New" count={newCount} icon={<Sparkles size={14} />} tone="bg-info/10 text-info" active={activeId === '__new'} onSelect={onSelect} />
        )}
        {categories.length > 0 && <div className="my-1 border-t border-border" />}
        {categories.map((c) => (
          <Row
            key={c.id}
            id={c.id}
            label={categoryDisplayName(c.name)}
            count={c.count}
            icon={<span className="text-[13px] leading-none">{categoryEmoji(c.name)}</span>}
            tone={toneFor(c.name)}
            active={activeId === c.id}
            onSelect={onSelect}
          />
        ))}
      </div>

      {onAddCategory && (
        <div className="shrink-0 border-t border-border pt-2">
          {adding ? (
            <div className="space-y-1.5">
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit()
                  if (e.key === 'Escape') { setAdding(false); setName('') }
                }}
                placeholder="Category name"
                className="h-8 w-full rounded-[var(--radius-sm)] border border-border-strong bg-surface px-2 text-[12px] text-foreground placeholder:text-muted-foreground"
              />
              <div className="flex gap-1.5">
                <button
                  onClick={submit}
                  disabled={!name.trim() || addingCategory}
                  className="h-7 flex-1 rounded-[var(--radius-sm)] bg-primary text-[11.5px] font-medium text-primary-foreground disabled:opacity-40"
                >
                  {addingCategory ? 'Adding…' : 'Add'}
                </button>
                <button
                  onClick={() => { setAdding(false); setName('') }}
                  className="h-7 flex-1 rounded-[var(--radius-sm)] border border-border-strong text-[11.5px] font-medium text-foreground"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="flex min-h-9 w-full items-center justify-center gap-1.5 rounded-[var(--radius)] text-[12px] font-medium text-muted-foreground hover:bg-surface-subtle hover:text-foreground"
            >
              <Plus size={13} /> Add Category
            </button>
          )}
        </div>
      )}
    </div>
  )
}
