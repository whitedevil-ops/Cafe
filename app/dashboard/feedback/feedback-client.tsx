'use client'

import { useMemo, useState } from 'react'
import { Star, MessageSquareOff } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { formatDate } from '@/lib/datetime'

type Rel<T> = T | T[] | null
function one<T>(v: Rel<T>): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v
}

export type FeedbackEntry = {
  id: string
  rating: number
  comment: string | null
  created_at: string
  orders: Rel<{ short_code: string }>
}

export type FeedbackSummary = {
  count: number
  avg_rating: number
  by_star: Record<'1' | '2' | '3' | '4' | '5', number>
} | null

function Stars({ n, size = 14 }: { n: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={size} className={i <= n ? 'fill-warning text-warning' : 'text-border-strong'} />
      ))}
    </span>
  )
}

export default function FeedbackClient({
  timezone,
  initialEntries,
  initialSummary,
}: {
  timezone: string
  initialEntries: FeedbackEntry[]
  initialSummary: FeedbackSummary
}) {
  const [starFilter, setStarFilter] = useState<number | null>(null)
  const entries = useMemo(
    () => (starFilter === null ? initialEntries : initialEntries.filter((e) => e.rating === starFilter)),
    [initialEntries, starFilter],
  )

  const maxBar = Math.max(1, ...(initialSummary ? Object.values(initialSummary.by_star) : [0]))

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:py-8">
      <PageHeader title="Feedback" subtitle="What customers say right after their visit — collected from the receipt page, last 30 days shown in the summary." />

      {initialSummary && initialSummary.count > 0 ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-[auto_1fr]">
          <div className="rounded-xl border border-border bg-surface p-5 text-center sm:w-40">
            <p className="text-3xl font-semibold tracking-tight text-foreground">{initialSummary.avg_rating}</p>
            <div className="mt-1 flex justify-center"><Stars n={Math.round(initialSummary.avg_rating)} /></div>
            <p className="mt-1 text-[12px] text-muted-foreground">{initialSummary.count} review{initialSummary.count === 1 ? '' : 's'}</p>
          </div>
          <div className="rounded-xl border border-border bg-surface p-5">
            {([5, 4, 3, 2, 1] as const).map((n) => {
              const count = initialSummary.by_star[String(n) as '1' | '2' | '3' | '4' | '5']
              return (
                <button
                  key={n}
                  onClick={() => setStarFilter(starFilter === n ? null : n)}
                  className={`flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-1.5 py-1 text-left text-[12.5px] hover:bg-surface-subtle ${starFilter === n ? 'bg-primary-subtle' : ''}`}
                >
                  <span className="w-3 shrink-0 text-muted-foreground">{n}</span>
                  <Star size={11} className="shrink-0 fill-warning text-warning" />
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-subtle">
                    <span className="block h-full rounded-full bg-warning" style={{ width: `${(count / maxBar) * 100}%` }} />
                  </span>
                  <span className="w-6 shrink-0 text-right text-muted-foreground">{count}</span>
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        <p className="mt-6 rounded-[var(--radius)] bg-info-subtle px-3 py-2.5 text-[13px] text-info">
          No feedback in the last 30 days yet — it fills in as customers rate their visit from the receipt page.
        </p>
      )}

      <div className="mt-8">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
            {starFilter ? `${starFilter}-star reviews` : 'All reviews'} ({entries.length})
          </p>
          {starFilter && (
            <button onClick={() => setStarFilter(null)} className="text-[12.5px] font-medium text-primary hover:underline">Clear filter</button>
          )}
        </div>

        {entries.length === 0 ? (
          <div className="mt-3 flex flex-col items-center gap-2 rounded-xl border border-border bg-surface py-10 text-muted-foreground">
            <MessageSquareOff size={20} />
            <p className="text-[13px]">Nothing here yet.</p>
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {entries.map((e) => {
              const order = one(e.orders)
              return (
                <li key={e.id} className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
                  <div className="flex items-center justify-between gap-3">
                    <Stars n={e.rating} />
                    <span className="text-[12px] text-muted-foreground">
                      {order && `#${order.short_code} · `}{formatDate(e.created_at, timezone)}
                    </span>
                  </div>
                  {e.comment && <p className="mt-2 text-[13.5px] text-foreground">{e.comment}</p>}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
