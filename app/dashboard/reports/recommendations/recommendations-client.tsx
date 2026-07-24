'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { businessDaysAgoStartISO } from '@/lib/datetime'
import { ReportsSubnav } from '../_shared'

type ItemRow = { name: string; shown: number; added: number; conversion: number; added_sales: number }
type Pairing = { a: string; b: string; times: number }
type Payload = { items: ItemRow[]; top_pairings: Pairing[] }

const money = (n: number) => `₹${n.toLocaleString('en-IN')}`

export default function RecommendationsClient({ cafeId, timezone }: { cafeId: string; timezone: string }) {
  const [payload, setPayload] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const from = businessDaysAgoStartISO(29, timezone)
    const to = new Date().toISOString()
    const { data, error: err } = await supabase.rpc('recommendation_report', { p_cafe_id: cafeId, p_from: from, p_to: to })
    setLoading(false)
    if (err) return setError(err.message)
    setPayload(data as Payload)
  }, [cafeId, timezone])

  useEffect(() => {
    // load() is async and only calls setState after its own network round-trip
    // completes — not a synchronous render-phase update.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <ReportsSubnav active="/dashboard/reports/recommendations" canSeeProfit={true} />

      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Smart recommendations</h1>
      <p className="mt-1 max-w-xl text-sm text-muted-foreground">
        Last 30 days. See which suggestions actually get added — remove anything that doesn&apos;t convert.
      </p>

      {error && <p className="mt-4 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">{error}</p>}

      {loading ? (
        <p className="mt-8 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="mt-6 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[600px] text-left text-[13px]">
              <thead className="bg-surface-subtle text-[12px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Suggested item</th>
                  <th className="px-3 py-2.5 text-right font-medium">Shown</th>
                  <th className="px-3 py-2.5 text-right font-medium">Added</th>
                  <th className="px-3 py-2.5 text-right font-medium">Conversion</th>
                  <th className="px-3 py-2.5 text-right font-medium">Added sales</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-surface">
                {(payload?.items ?? []).length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">No recommendation activity yet.</td></tr>
                ) : (
                  payload!.items.map((i) => (
                    <tr key={i.name} className="hover:bg-surface-subtle">
                      <td className="px-3 py-2.5 font-medium text-foreground">{i.name}</td>
                      <td className="px-3 py-2.5 text-right text-muted-foreground">{i.shown}</td>
                      <td className="px-3 py-2.5 text-right text-muted-foreground">{i.added}</td>
                      <td className={`px-3 py-2.5 text-right font-medium ${i.conversion >= 20 ? 'text-success' : i.conversion > 0 ? 'text-warning' : 'text-muted-foreground'}`}>{i.conversion}%</td>
                      <td className="px-3 py-2.5 text-right font-medium text-foreground">{money(i.added_sales)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-8">
            <p className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">Top pairings</p>
            {(payload?.top_pairings ?? []).length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">Not enough order history yet — pairings appear once items are frequently ordered together.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {payload!.top_pairings.map((p, i) => (
                  <li key={i} className="flex items-center justify-between rounded-[var(--radius)] border border-border bg-surface px-3 py-2 text-[13px]">
                    <span className="text-foreground">{p.a} + {p.b}</span>
                    <span className="text-muted-foreground">{p.times}×</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}
