'use client'

import Link from 'next/link'
import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, ChevronsUpDown, MoreVertical } from 'lucide-react'

// Shared chrome for the operator console.
//
// Every screen in here previously hand-rolled its own h1, card, table and
// empty state, which is exactly why no two of them looked quite alike. These
// are deliberately small and unclever: the point is that a page cannot
// accidentally invent a fourth heading size.

/* ── Page shell ─────────────────────────────────────────────────────────── */

export function Page({ children, width = 'wide' }: { children: ReactNode; width?: 'wide' | 'full' }) {
  return (
    <div className={`mx-auto w-full ${width === 'full' ? 'max-w-7xl' : 'max-w-6xl'} px-5 py-8 sm:px-8 sm:py-10`}>
      {children}
    </div>
  )
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

/* ── Metrics ────────────────────────────────────────────────────────────── */

/**
 * The headline figures only. Giving ten numbers this treatment — which is what
 * the overview used to do — means none of them reads as more important than
 * any other, so the eye has nowhere to land. Secondary counts belong in
 * StatStrip.
 */
export function StatCard({
  label,
  value,
  hint,
  href,
}: {
  label: string
  value: number | string
  hint?: string
  href?: string
}) {
  const body = (
    <>
      <p className="text-[12.5px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-[28px] font-semibold leading-none tracking-tight tabular-nums text-foreground">
        {typeof value === 'number' ? value.toLocaleString('en-IN') : value}
      </p>
      {hint && <p className="mt-2 text-[12px] text-muted-foreground">{hint}</p>}
    </>
  )

  const base = 'block rounded-[var(--radius)] border border-border bg-surface p-5 shadow-[var(--shadow-sm)]'
  return href ? (
    <Link href={href} className={`${base} transition-colors hover:border-border-strong hover:bg-surface-subtle`}>
      {body}
    </Link>
  ) : (
    <div className={base}>{body}</div>
  )
}

export type StripTone = 'neutral' | 'success' | 'warning' | 'destructive' | 'info'

const DOT: Record<StripTone, string> = {
  neutral: 'bg-muted-foreground',
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  info: 'bg-info',
}

/**
 * Secondary counts as one segmented row rather than a second grid of cards.
 * These describe states of the same population, so they read better side by
 * side than stacked in identical boxes.
 */
export function StatStrip({ items }: { items: { label: string; value: number; tone?: StripTone; href?: string }[] }) {
  return (
    <div className="grid grid-cols-2 divide-x divide-y divide-border overflow-hidden rounded-[var(--radius)] border border-border bg-surface sm:grid-cols-4 sm:divide-y-0">
      {items.map((i) => {
        const inner = (
          <>
            <span className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[i.tone ?? 'neutral']}`} />
              {i.label}
            </span>
            <span className="mt-1.5 block text-[19px] font-semibold tabular-nums text-foreground">
              {i.value.toLocaleString('en-IN')}
            </span>
          </>
        )
        return i.href ? (
          <Link key={i.label} href={i.href} className="p-4 transition-colors hover:bg-surface-subtle">
            {inner}
          </Link>
        ) : (
          <div key={i.label} className="p-4">
            {inner}
          </div>
        )
      })}
    </div>
  )
}

/* ── Panels ─────────────────────────────────────────────────────────────── */

export function Panel({
  title,
  action,
  children,
  count,
  tone,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
  /** Shown as a badge beside the title — usually "how many need attention". */
  count?: number
  tone?: StripTone
}) {
  return (
    <section className="flex flex-col rounded-[var(--radius)] border border-border bg-surface shadow-[var(--shadow-sm)]">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <div className="flex items-center gap-2">
          <h2 className="text-[13.5px] font-semibold text-foreground">{title}</h2>
          {count !== undefined && count > 0 && <Badge tone={tone ?? 'warning'}>{count}</Badge>}
        </div>
        {action}
      </div>
      <div className="flex-1 px-5 py-4">{children}</div>
    </section>
  )
}

export function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-[12.5px] font-medium text-primary hover:underline">
      {children}
    </Link>
  )
}

export function EmptyState({ message }: { message: string }) {
  return <p className="py-2 text-[13px] text-muted-foreground">{message}</p>
}

/** A whole-page empty/no-results block, distinct from an empty panel. */
export function EmptyPanel({ message }: { message: string }) {
  return (
    <div className="rounded-[var(--radius)] border border-dashed border-border-strong bg-surface p-12 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

/* ── Badges ─────────────────────────────────────────────────────────────── */

const BADGE: Record<StripTone, string> = {
  neutral: 'bg-surface-subtle text-muted-foreground',
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
  destructive: 'bg-destructive-subtle text-destructive',
  info: 'bg-info-subtle text-info',
}

export function Badge({ tone = 'neutral', children }: { tone?: StripTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-medium capitalize tabular-nums ${BADGE[tone]}`}>
      {children}
    </span>
  )
}

/* ── Tables ─────────────────────────────────────────────────────────────── */

export function TableWrap({ children, minWidth = 720 }: { children: ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius)] border border-border bg-surface shadow-[var(--shadow-sm)]">
      <table className="w-full text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  )
}

/** Sticky so the column meanings survive a long café list. */
export function Thead({ children }: { children: ReactNode }) {
  return (
    <thead className="sticky top-0 z-10 bg-surface-subtle">
      <tr className="border-b border-border text-left text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
        {children}
      </tr>
    </thead>
  )
}

export function Th({
  children,
  align = 'left',
  sortDir,
  onSort,
}: {
  children: ReactNode
  align?: 'left' | 'right'
  /** Only meaningful when onSort is passed. null = sortable but not the active column. */
  sortDir?: 'asc' | 'desc' | null
  /** Presence makes the header clickable; omit for a plain static header (today's behavior). */
  onSort?: () => void
}) {
  if (!onSort) {
    return <th className={`px-4 py-2.5 font-medium ${align === 'right' ? 'text-right' : ''}`}>{children}</th>
  }
  return (
    <th className={`px-4 py-2.5 font-medium ${align === 'right' ? 'text-right' : ''}`}>
      <button
        onClick={onSort}
        className={`inline-flex items-center gap-1 hover:text-foreground ${align === 'right' ? 'flex-row-reverse' : ''} ${sortDir ? 'text-foreground' : ''}`}
      >
        {children}
        {sortDir === 'asc' && <ChevronUp size={12} />}
        {sortDir === 'desc' && <ChevronDown size={12} />}
        {!sortDir && <ChevronsUpDown size={12} className="opacity-40" />}
      </button>
    </th>
  )
}

export function Td({
  children,
  align = 'left',
  muted = false,
  numeric = false,
}: {
  children: ReactNode
  align?: 'left' | 'right'
  muted?: boolean
  numeric?: boolean
}) {
  return (
    <td
      className={`px-4 py-3 ${align === 'right' ? 'text-right' : ''} ${muted ? 'text-muted-foreground' : 'text-foreground'} ${
        numeric ? 'tabular-nums' : ''
      }`}
    >
      {children}
    </td>
  )
}

export function Tr({ children }: { children: ReactNode }) {
  return <tr className="border-b border-border last:border-0 transition-colors hover:bg-surface-subtle">{children}</tr>
}

/** A UUID prefix. Monospaced so two of them are actually comparable by eye. */
export function MonoId({ id }: { id: string }) {
  return <span className="font-mono text-[11px] tracking-tight text-muted-foreground">{id.slice(0, 8)}</span>
}

/* ── Proportion bar ─────────────────────────────────────────────────────── */

/**
 * For breakdowns where the split matters more than the raw counts — a bare
 * list of "starter 4 / growth 1" makes you do the ratio in your head.
 */
export function ProportionRow({
  label,
  value,
  total,
  formatValue,
}: {
  label: string
  value: number
  total: number
  /** Defaults to the raw number — pass this to render money (e.g. `₹${v.toLocaleString('en-IN')}`) instead. */
  formatValue?: (v: number) => string
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <li className="py-1.5">
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="capitalize text-foreground">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {formatValue ? formatValue(value) : value} <span className="text-[11.5px]">({pct}%)</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-subtle">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </li>
  )
}

/* ── Row actions menu ───────────────────────────────────────────────────── */

/**
 * A kebab-menu whose panel renders through a portal to <body>, positioned
 * from the trigger button's own bounding rect -- not a plain `absolute`
 * child of the table row. A wide table's wrapper needs `overflow-x-auto`,
 * and per the CSS overflow spec, setting only overflow-x to a non-visible
 * value forces the COMPUTED overflow-y to 'auto' too, even though overflow-y
 * was never set -- so a menu positioned `absolute` inside that wrapper gets
 * clipped by the table's own edges instead of floating freely above/below
 * the row. Portaling to <body> sidesteps that clipping ancestor entirely.
 * Previously duplicated near-identically in both cafes-client.tsx and
 * admins-client.tsx (each with the plain-absolute version, and each
 * clipped) -- consolidated here once, fixed once.
 */
export function ActionsMenu({
  open,
  onToggle,
  onClose,
  children,
  width = 208,
}: {
  open: boolean
  onToggle: () => void
  onClose: () => void
  children: ReactNode
  width?: number
}) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    // No need to clear pos when closing -- the portal below is gated on
    // `open` too, so a stale coordinate just sits unused until the next
    // open recomputes it.
    if (!open) return
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect) setPos({ top: rect.bottom + 4, left: Math.max(8, rect.right - width) })

    // The portal doesn't move with the row, so a scroll would leave it
    // floating over the wrong spot -- closing on scroll is simpler and
    // safer than continuously re-tracking the trigger's position.
    window.addEventListener('scroll', onClose, true)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('scroll', onClose, true)
      window.removeEventListener('resize', onClose)
    }
  }, [open, onClose, width])

  return (
    <>
      <button
        ref={btnRef}
        onClick={onToggle}
        aria-label="Actions"
        className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] text-muted-foreground hover:bg-surface-subtle hover:text-foreground"
      >
        <MoreVertical size={16} />
      </button>
      {open && pos && typeof document !== 'undefined' &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={onClose} />
            <div
              className="fixed z-50 rounded-[var(--radius-lg)] border border-border bg-surface p-1.5 text-left shadow-[var(--shadow-lg)]"
              style={{ top: pos.top, left: pos.left, width }}
            >
              {children}
            </div>
          </>,
          document.body,
        )}
    </>
  )
}

export function MenuItem({
  children,
  onClick,
  disabled,
  destructive,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  destructive?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center rounded-[var(--radius)] px-2.5 py-2 text-left text-[13px] disabled:opacity-50 ${
        destructive ? 'text-destructive hover:bg-destructive-subtle' : 'text-foreground hover:bg-surface-subtle'
      }`}
    >
      {children}
    </button>
  )
}
