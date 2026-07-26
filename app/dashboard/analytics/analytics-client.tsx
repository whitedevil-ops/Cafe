'use client'

import { useMemo } from 'react'
import { PageHeader } from '@/components/ui/page-header'
import { Section, Kpi, RangePicker, useReportRange } from '../reports/_shared'

export type AnalyticsReport = {
  daily_revenue: { date: string; revenue: number; orders: number }[]
  hourly_heatmap: { dow: number; hour: number; revenue: number; orders: number }[]
  repeat: { new_customers: number; returning_customers: number; repeat_rate_pct: number }
  forecast_next_7d: number
}

const DOW_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const PERIODS: { label: string; hours: number[] }[] = [
  { label: 'Morning (6–11)', hours: [6, 7, 8, 9, 10] },
  { label: 'Afternoon (11–16)', hours: [11, 12, 13, 14, 15] },
  { label: 'Evening (16–21)', hours: [16, 17, 18, 19, 20] },
  { label: 'Night (21–6)', hours: [21, 22, 23, 0, 1, 2, 3, 4, 5] },
]

function BarChart({ data }: { data: { date: string; revenue: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.revenue))
  const w = Math.max(data.length * 14, 280)
  const h = 140
  const showLabelEvery = Math.max(1, Math.ceil(data.length / 8))

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h + 20}`} width={w} height={h + 20} className="min-w-full">
        {data.map((d, i) => {
          const barH = Math.round((d.revenue / max) * (h - 8))
          const x = i * 14
          return (
            <g key={d.date}>
              <rect x={x + 2} y={h - barH} width={10} height={barH} rx={2} className="fill-primary" />
              {i % showLabelEvery === 0 && (
                <text x={x + 7} y={h + 14} textAnchor="middle" className="fill-current text-[9px] text-muted-foreground">
                  {d.date.slice(5)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function Heatmap({ cells, max }: { cells: Map<string, number>; max: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-separate border-spacing-1 text-[11px]">
        <thead>
          <tr>
            <th className="w-28 text-left font-medium text-muted-foreground" />
            {DOW_LABEL.map((d) => (
              <th key={d} className="pb-1 text-center font-medium text-muted-foreground">{d}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PERIODS.map((p) => (
            <tr key={p.label}>
              <td className="pr-2 text-muted-foreground">{p.label}</td>
              {DOW_LABEL.map((_, dow) => {
                const v = cells.get(`${dow}:${p.label}`) ?? 0
                const alpha = max > 0 ? Math.max(0.06, v / max) : 0.06
                return (
                  <td key={dow} className="p-0">
                    <div
                      className="grid h-9 place-items-center rounded-[var(--radius-sm)] text-[10px] font-medium text-foreground"
                      style={{ backgroundColor: `color-mix(in srgb, var(--primary) ${Math.round(alpha * 100)}%, transparent)` }}
                      title={`₹${v.toLocaleString('en-IN')}`}
                    >
                      {v > 0 ? `₹${Math.round(v / 1000)}k` : ''}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function AnalyticsClient({
  cafeId,
  timezone,
  initialFrom,
  initialTo,
  initialReport,
}: {
  cafeId: string
  timezone: string
  initialFrom: string
  initialTo: string
  initialReport: AnalyticsReport | null
}) {
  const { report, loading, error, preset, choosePreset, customFrom, setCustomFrom, customTo, setCustomTo, applyCustom } =
    useReportRange<AnalyticsReport>({ cafeId, timezone, rpc: 'advanced_analytics_report', initialFrom, initialTo, initialReport })

  const heatmapCells = useMemo(() => {
    const cells = new Map<string, number>()
    let max = 0
    for (const h of report?.hourly_heatmap ?? []) {
      const period = PERIODS.find((p) => p.hours.includes(h.hour))
      if (!period) continue
      const key = `${h.dow}:${period.label}`
      const next = (cells.get(key) ?? 0) + h.revenue
      cells.set(key, next)
      if (next > max) max = next
    }
    return { cells, max }
  }, [report])

  const totalCustomers = (report?.repeat.new_customers ?? 0) + (report?.repeat.returning_customers ?? 0)

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <PageHeader
        title="Analytics"
        subtitle="Trends and patterns beyond a single period total — where revenue is heading, when the café is actually busy, and how many customers keep coming back."
      />
      <RangePicker preset={preset} choosePreset={choosePreset} customFrom={customFrom} setCustomFrom={setCustomFrom} customTo={customTo} setCustomTo={setCustomTo} applyCustom={applyCustom} />

      {error && <p className="mt-4 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">{error}</p>}

      {loading ? (
        <p className="mt-8 text-sm text-muted-foreground">Loading…</p>
      ) : !report ? (
        <p className="mt-8 text-sm text-muted-foreground">No data for this range.</p>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <Kpi label="Repeat customer rate" value={`${report.repeat.repeat_rate_pct}%`} />
            <Kpi label="New vs returning" value={`${report.repeat.new_customers} / ${report.repeat.returning_customers}`} />
            <Kpi label="Next 7 days (projected)" value={`₹${report.forecast_next_7d.toLocaleString('en-IN')}`} />
          </div>
          {totalCustomers === 0 && (
            <p className="mt-2 text-[12px] text-muted-foreground">No customer-linked orders in this range yet — repeat rate needs a phone number on the order.</p>
          )}

          <Section title="Revenue trend">
            {report.daily_revenue.length === 0 ? (
              <p className="text-sm text-muted-foreground">No orders in this range.</p>
            ) : (
              <BarChart data={report.daily_revenue} />
            )}
          </Section>

          <Section title="When the café is busiest">
            <p className="mb-3 text-[12px] text-muted-foreground">Revenue by day and time-of-day period — darker means busier.</p>
            <Heatmap cells={heatmapCells.cells} max={heatmapCells.max} />
          </Section>

          <p className="mt-6 text-[11.5px] text-muted-foreground">
            The 7-day projection is a simple trailing average (last 7 days × 7) — a rough guide, not a demand forecast model.
          </p>
        </>
      )}
    </div>
  )
}
