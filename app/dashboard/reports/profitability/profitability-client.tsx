'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import { businessDayStartISO, businessDaysAgoStartISO } from '@/lib/datetime'
import { exportProfitabilityXlsx } from '@/lib/xlsx-export'

type Item = {
  menu_item_id: string | null
  name: string
  qty: number
  sales: number
  cost: number
  contribution: number
  margin_pct: number
  has_cost: boolean
}
type Payload = {
  summary: { net_sales: number; cost: number; contribution: number; margin_pct: number }
  items: Item[]
}
type Range = 'today' | '7d' | '30d' | 'custom'
type OType = 'all' | 'dine_in' | 'takeaway'

const money = (n: number) => `₹${n.toLocaleString('en-IN')}`

export default function ProfitabilityClient({ cafeId, cafeName, timezone }: { cafeId: string; cafeName: string; timezone: string }) {
  const supabase = useMemo(() => createClient(), [])
  const [payload, setPayload] = useState<Payload | null>(null)
  const [range, setRange] = useState<Range>('30d')
  const [type, setType] = useState<OType>('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const bounds = useCallback(
    (r: Range): { from: string; to: string } => {
      const now = new Date(Date.now() + 60_000).toISOString()
      if (r === 'today') return { from: businessDayStartISO(timezone), to: now }
      if (r === '7d') return { from: businessDaysAgoStartISO(6, timezone), to: now }
      if (r === 'custom' && customFrom && customTo) {
        return {
          from: businessDayStartISO(timezone, new Date(`${customFrom}T12:00:00Z`)),
          to: businessDayStartISO(timezone, new Date(new Date(`${customTo}T12:00:00Z`).getTime() + 86400000)),
        }
      }
      return { from: businessDaysAgoStartISO(29, timezone), to: now }
    },
    [timezone, customFrom, customTo],
  )

  const load = useCallback(
    async (r: Range, t: OType) => {
      setLoading(true)
      setError(null)
      const { from, to } = bounds(r)
      const { data, error: err } = await supabase.rpc('profitability_report', {
        p_cafe_id: cafeId,
        p_from: from,
        p_to: to,
        p_type: t,
      })
      setLoading(false)
      if (err) return setError(err.message)
      setPayload(data as Payload)
    },
    [supabase, cafeId, bounds],
  )

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load('30d', 'all')
  }, [load])

  const items = useMemo(() => payload?.items ?? [], [payload])
  const s = payload?.summary

  // Insights (simple, accurate — no AI, per spec).
  const insights = useMemo(() => {
    if (items.length === 0) return null
    const withSales = items.filter((i) => i.sales > 0)
    const topContrib = [...items].sort((a, b) => b.contribution - a.contribution)[0]
    const lowMargin = [...withSales].filter((i) => i.has_cost).sort((a, b) => a.margin_pct - b.margin_pct)[0]
    const highCost = [...items].sort((a, b) => b.cost - a.cost)[0]
    return { topContrib, lowMargin, highCost }
  }, [items])

  const missingCost = items.some((i) => !i.has_cost)

  const rangeChips: [Range, string][] = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['custom', 'Custom']]
  const typeChips: [OType, string][] = [['all', 'All'], ['dine_in', 'Dine-in'], ['takeaway', 'Takeaway']]

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] text-muted-foreground"><Link href="/dashboard/reports" className="hover:underline">Reports</Link> / Profitability</p>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-foreground">Profitability</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Estimated contribution by item, from actual finalised orders — after discounts and refunds, excluding
            cancelled orders and tax. This is gross contribution, not net profit (rent, salaries and utilities are not included).
          </p>
        </div>
        <button
          onClick={() => s && exportProfitabilityXlsx({ cafeName, summary: s, items, from: bounds(range).from, to: bounds(range).to, type })}
          disabled={!s || items.length === 0}
          className="min-h-10 rounded-[var(--radius)] border border-border-strong bg-surface px-4 text-[13px] font-medium text-foreground hover:bg-surface-subtle disabled:opacity-40"
        >
          Export Excel
        </button>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {typeChips.map(([k, l]) => (
          <button key={k} onClick={() => { setType(k); void load(range, k) }}
            className={`min-h-9 rounded-full border px-4 text-[13px] font-medium transition-colors ${type === k ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-muted-foreground hover:bg-surface-subtle'}`}>{l}</button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {rangeChips.map(([k, l]) => (
          <button key={k} onClick={() => { setRange(k); if (k !== 'custom') void load(k, type) }}
            className={`min-h-9 rounded-[var(--radius)] border px-3 text-[12.5px] font-medium transition-colors ${range === k ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-muted-foreground hover:bg-surface-subtle'}`}>{l}</button>
        ))}
      </div>
      {range === 'custom' && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="min-h-10 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm text-foreground" />
          <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="min-h-10 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm text-foreground" />
          <button onClick={() => void load('custom', type)} className="min-h-10 rounded-[var(--radius)] bg-primary px-4 text-sm font-medium text-primary-foreground">Apply</button>
        </div>
      )}

      {error && <p className="mt-4 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">{error}</p>}

      {s && (
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric label="Net item sales" value={money(s.net_sales)} />
          <Metric label="Estimated direct cost" value={money(s.cost)} />
          <Metric label="Gross contribution" value={money(s.contribution)} tone="success" />
          <Metric label="Contribution margin" value={`${s.margin_pct}%`} />
        </div>
      )}

      {missingCost && (
        <p className="mt-3 rounded-[var(--radius)] bg-warning-subtle px-3 py-2 text-[12.5px] text-warning">
          Some items have no cost set (shown as “—”). Add estimated costs in <Link href="/dashboard/menu" className="font-medium underline">Menu</Link> so their contribution is accurate. Orders sold before costing was enabled have no cost snapshot.
        </p>
      )}

      {insights && (
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Insight tone="success" head="Top contributor" name={insights.topContrib.name} sub={`${money(insights.topContrib.contribution)} contribution`} />
          {insights.lowMargin && <Insight tone="warning" head="Lowest margin" name={insights.lowMargin.name} sub={`${insights.lowMargin.margin_pct}% · ${money(insights.lowMargin.contribution)}`} />}
          <Insight tone="neutral" head="Highest cost" name={insights.highCost.name} sub={`${money(insights.highCost.cost)} cost`} />
        </div>
      )}

      <div className="mt-6 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[720px] text-left text-[13px]">
          <thead className="bg-surface-subtle text-[12px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2.5 font-medium">Item</th>
              <th className="px-3 py-2.5 text-right font-medium">Qty</th>
              <th className="px-3 py-2.5 text-right font-medium">Net sales</th>
              <th className="px-3 py-2.5 text-right font-medium">Est. cost</th>
              <th className="px-3 py-2.5 text-right font-medium">Contribution</th>
              <th className="px-3 py-2.5 text-right font-medium">Margin</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-surface">
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No sales in this range.</td></tr>
            ) : (
              items.map((i) => (
                <tr key={i.menu_item_id ?? i.name} className="hover:bg-surface-subtle">
                  <td className="px-3 py-2.5 font-medium text-foreground">{i.name}</td>
                  <td className="px-3 py-2.5 text-right text-muted-foreground">{i.qty}</td>
                  <td className="px-3 py-2.5 text-right text-foreground">{money(i.sales)}</td>
                  <td className="px-3 py-2.5 text-right text-muted-foreground">{i.has_cost ? money(i.cost) : '—'}</td>
                  <td className={`px-3 py-2.5 text-right font-medium ${i.contribution < 0 ? 'text-destructive' : 'text-foreground'}`}>{money(i.contribution)}</td>
                  <td className={`px-3 py-2.5 text-right ${!i.has_cost ? 'text-muted-foreground' : i.margin_pct < 25 ? 'text-warning' : 'text-success'}`}>{i.has_cost ? `${i.margin_pct}%` : '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'success' }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-[12.5px] text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-xl font-semibold tracking-tight ${tone === 'success' ? 'text-success' : 'text-foreground'}`}>{value}</p>
    </div>
  )
}

function Insight({ tone, head, name, sub }: { tone: 'success' | 'warning' | 'neutral'; head: string; name: string; sub: string }) {
  const cls = tone === 'success' ? 'border-success bg-success-subtle' : tone === 'warning' ? 'border-warning bg-warning-subtle' : 'border-border bg-surface-subtle'
  return (
    <div className={`rounded-xl border p-4 ${cls}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{head}</p>
      <p className="mt-1 truncate text-[15px] font-semibold text-foreground">{name}</p>
      <p className="text-[12.5px] text-muted-foreground">{sub}</p>
    </div>
  )
}
