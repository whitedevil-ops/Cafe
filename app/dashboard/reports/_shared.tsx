'use client'

// Shared chrome for every Reports V2 page: the same date-range presets, the
// same load/error/loading plumbing, and the same visual primitives Overview
// established (business_overview_report). One place so every report reads as
// the same product instead of five different ones bolted together.
import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import { businessDayKey, businessDayStartISO, businessDaysAgoStartISO } from '@/lib/datetime'

export type Preset = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'custom'

export const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'month', label: 'This month' },
  { key: 'custom', label: 'Custom' },
]

export function rangeFor(preset: Preset, timezone: string): { from: string; to: string } {
  const now = new Date()
  if (preset === 'today') return { from: businessDayStartISO(timezone), to: now.toISOString() }
  if (preset === 'yesterday') {
    const from = businessDaysAgoStartISO(1, timezone)
    return { from, to: businessDayStartISO(timezone) }
  }
  if (preset === '30d') return { from: businessDaysAgoStartISO(29, timezone), to: now.toISOString() }
  if (preset === 'month') {
    const key = businessDayKey(now, timezone)
    const monthStart = new Date(`${key.slice(0, 7)}-01T12:00:00Z`)
    return { from: businessDayStartISO(timezone, monthStart), to: now.toISOString() }
  }
  return { from: businessDaysAgoStartISO(6, timezone), to: now.toISOString() }
}

// One hook per report page: identical date-range/loading/error plumbing,
// parameterised only by which RPC to call and any extra params it needs
// (e.g. GST report's p_type). `report` is typed by the caller.
export function useReportRange<T>(args: {
  cafeId: string
  timezone: string
  rpc: string
  initialFrom: string
  initialTo: string
  initialReport: T | null
  extraParams?: Record<string, unknown>
}) {
  const { cafeId, timezone, rpc, initialFrom, initialTo, initialReport, extraParams } = args
  const supabase = useMemo(() => createClient(), [])
  const [preset, setPreset] = useState<Preset>('7d')
  const [customFrom, setCustomFrom] = useState(businessDayKey(initialFrom, timezone))
  const [customTo, setCustomTo] = useState(businessDayKey(initialTo, timezone))
  const [report, setReport] = useState<T | null>(initialReport)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (from: string, to: string) => {
      setLoading(true)
      setError(null)
      const { data, error: err } = await supabase.rpc(rpc, { p_cafe_id: cafeId, p_from: from, p_to: to, ...extraParams })
      setLoading(false)
      if (err) return setError(err.message)
      setReport(data as T)
    },
    [supabase, cafeId, rpc, extraParams],
  )

  function choosePreset(p: Preset) {
    setPreset(p)
    if (p === 'custom') return
    const { from, to } = rangeFor(p, timezone)
    void load(from, to)
  }

  function applyCustom() {
    if (!customFrom || !customTo) return
    const from = businessDayStartISO(timezone, new Date(`${customFrom}T12:00:00Z`))
    const toNextDay = new Date(new Date(`${customTo}T12:00:00Z`).getTime() + 86400_000)
    const to = businessDayStartISO(timezone, toNextDay)
    void load(from, to)
  }

  function activeRange(): { from: string; to: string } {
    if (preset === 'custom' && customFrom && customTo) {
      const from = businessDayStartISO(timezone, new Date(`${customFrom}T12:00:00Z`))
      const to = businessDayStartISO(timezone, new Date(new Date(`${customTo}T12:00:00Z`).getTime() + 86400_000))
      return { from, to }
    }
    return rangeFor(preset, timezone)
  }

  return { report, loading, error, preset, choosePreset, customFrom, setCustomFrom, customTo, setCustomTo, applyCustom, activeRange, reload: load }
}

// A metric's "up" isn't always "good" (refunds falling IS good) — the caller
// says which direction is favourable, this just renders colour/arrow.
export function Change({ current, previous, higherIsBetter = true }: { current: number; previous: number; higherIsBetter?: boolean }) {
  if (previous === 0) return current === 0 ? null : <span className="text-[12px] text-muted-foreground">new</span>
  const pct = Math.round(((current - previous) / Math.abs(previous)) * 100)
  if (pct === 0) return <span className="text-[12px] text-muted-foreground">flat</span>
  const up = pct > 0
  const good = up === higherIsBetter
  return (
    <span className={`text-[12px] font-medium ${good ? 'text-success' : 'text-destructive'}`}>
      {up ? '↑' : '↓'} {Math.abs(pct)}%
    </span>
  )
}

export function Kpi({ label, value, tone, change }: { label: string; value: string; tone?: 'success' | 'destructive'; change?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-[12.5px] text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold tracking-tight ${tone === 'success' ? 'text-success' : tone === 'destructive' ? 'text-destructive' : 'text-foreground'}`}>
        {value}
      </p>
      {change}
    </div>
  )
}

export function Row({ label, value, bold = false }: { label: string; value: number; bold?: boolean }) {
  const negative = value < 0
  return (
    <li className={`flex items-center justify-between gap-3 ${bold ? 'font-semibold text-foreground' : 'text-foreground'}`}>
      <span>{label}</span>
      <span className={negative ? 'text-destructive' : ''}>
        {negative ? '-' : ''}₹{Math.abs(value).toLocaleString('en-IN')}
      </span>
    </li>
  )
}

export function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mt-8 first:mt-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
        {action}
      </div>
      <div className="mt-3 rounded-xl border border-border bg-surface p-4">{children}</div>
    </div>
  )
}

export function List({ rows }: { rows: { label: string; value: number }[] }) {
  return (
    <ul className="space-y-2">
      {rows.map((r, i) => (
        <li key={i} className="flex items-center justify-between gap-3 text-sm">
          <span className="min-w-0 truncate text-foreground">{r.label}</span>
          <span className="shrink-0 font-medium text-foreground">₹{r.value.toLocaleString('en-IN')}</span>
        </li>
      ))}
    </ul>
  )
}

// One nav strip, every report page — so nine separate reports read as one
// product instead of nine bolted-on pages each linking to a different subset
// of its siblings.
export const REPORT_LINKS: { href: string; label: string; ownerOnly?: boolean }[] = [
  { href: '/dashboard/reports', label: 'Overview' },
  { href: '/dashboard/reports/sales', label: 'Sales' },
  { href: '/dashboard/reports/items', label: 'Items & Categories' },
  { href: '/dashboard/reports/payments', label: 'Payments & Aging' },
  { href: '/dashboard/reports/gst', label: 'GST' },
  { href: '/dashboard/reports/adjustments', label: 'Adjustments' },
  { href: '/dashboard/reports/operations', label: 'Operations' },
  { href: '/dashboard/reports/profitability', label: 'Profitability', ownerOnly: true },
  { href: '/dashboard/reports/recommendations', label: 'Recommendations', ownerOnly: true },
]

export function ReportsSubnav({ active, canSeeProfit }: { active: string; canSeeProfit: boolean }) {
  const links = REPORT_LINKS.filter((l) => !l.ownerOnly || canSeeProfit)
  return (
    <nav className="-mx-1 mb-6 flex flex-wrap gap-1 border-b border-border pb-3">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
            l.href === active ? 'bg-primary-subtle text-primary' : 'text-muted-foreground hover:bg-surface-subtle hover:text-foreground'
          }`}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  )
}

export function ReportHeader({
  title,
  subtitle,
  links,
  onExport,
  canExport,
}: {
  title: string
  subtitle: string
  links: { href: string; label: string }[]
  onExport: () => void
  canExport: boolean
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {links.map((l) => (
          <a key={l.href} href={l.href} className="min-h-10 rounded-[var(--radius)] border border-border-strong bg-surface px-4 text-[13px] font-medium leading-10 text-foreground hover:bg-surface-subtle">
            {l.label}
          </a>
        ))}
        <button onClick={onExport} disabled={!canExport} className="min-h-10 rounded-[var(--radius)] bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-40">
          Export Excel
        </button>
      </div>
    </div>
  )
}

export function RangePicker({
  preset,
  choosePreset,
  customFrom,
  setCustomFrom,
  customTo,
  setCustomTo,
  applyCustom,
}: {
  preset: Preset
  choosePreset: (p: Preset) => void
  customFrom: string
  setCustomFrom: (v: string) => void
  customTo: string
  setCustomTo: (v: string) => void
  applyCustom: () => void
}) {
  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => choosePreset(p.key)}
            className={`min-h-9 rounded-[var(--radius)] border px-3 text-[13px] font-medium transition-colors ${
              preset === p.key ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-muted-foreground hover:bg-surface-subtle'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {preset === 'custom' && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-[13px] text-foreground">
            <span className="block text-muted-foreground">From</span>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
              className="min-h-10 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm text-foreground" />
          </label>
          <label className="space-y-1 text-[13px] text-foreground">
            <span className="block text-muted-foreground">To</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
              className="min-h-10 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm text-foreground" />
          </label>
          <button onClick={applyCustom} className="min-h-10 rounded-[var(--radius)] bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
            Apply
          </button>
        </div>
      )}
    </>
  )
}
