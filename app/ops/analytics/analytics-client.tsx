'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { EmptyState, Page, PageHeader, Panel, ProportionRow, StatCard } from '@/components/ops/ui'

export type PlatformAnalytics = {
  from: string
  to: string
  orders_by_source: { source: string; orders: number; revenue: number }[]
  payment_method_mix: { method: string; amount: number; transactions: number }[]
}

// order_source enum has a third value, 'staff', that no RPC currently ever
// inserts (place_order always writes 'qr', staff_place_order always writes
// 'pos') -- kept here so a future channel doesn't render as a raw enum key.
const SOURCE_LABEL: Record<string, string> = { qr: 'QR ordering', pos: 'Staff POS', staff: 'Staff (other)' }
// Mirrors app/dashboard/reports/payments/payments-client.tsx's METHOD_LABEL
// exactly, so a payment method reads the same word here as it does on the
// café owner's own report.
const METHOD_LABEL: Record<string, string> = { cash: 'Cash', card: 'Card', counter: 'Pay at counter', upi: 'UPI', split: 'Split', wallet: 'Wallet' }

const money = (v: number) => `₹${v.toLocaleString('en-IN')}`

const PRESETS: { key: string; label: string; days: number | null }[] = [
  { key: '7', label: 'Last 7 days', days: 7 },
  { key: '30', label: 'Last 30 days', days: 30 },
  { key: '90', label: 'Last 90 days', days: 90 },
  { key: 'all', label: 'All time', days: null },
]

export default function AnalyticsClient({
  initialData,
  initialRangeKey,
}: {
  initialData: PlatformAnalytics | null
  initialRangeKey: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const [data, setData] = useState(initialData)
  const [preset, setPreset] = useState(initialRangeKey)
  const [loading, setLoading] = useState(false)

  async function choosePreset(key: string) {
    setPreset(key)
    setLoading(true)
    const p = PRESETS.find((x) => x.key === key)!
    const to = new Date()
    const from = p.days === null ? null : new Date(to.getTime() - p.days * 24 * 60 * 60 * 1000)
    const { data: next } = await supabase.rpc('op_platform_analytics', {
      p_from: from ? from.toISOString() : null,
      p_to: to.toISOString(),
    })
    setData((next ?? null) as PlatformAnalytics | null)
    setLoading(false)
  }

  const ordersTotal = data?.orders_by_source.reduce((s, o) => s + o.orders, 0) ?? 0
  const orderValueTotal = data?.orders_by_source.reduce((s, o) => s + o.revenue, 0) ?? 0
  const collectedTotal = data?.payment_method_mix.reduce((s, m) => s + m.amount, 0) ?? 0

  return (
    <Page>
      <PageHeader
        title="Platform analytics"
        subtitle="Orders and payments across every café — how they were placed, and how they were paid."
      />

      <div className="mt-5 flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => choosePreset(p.key)}
            className={`h-9 rounded-[var(--radius)] border px-3.5 text-[13px] font-medium transition-colors ${
              preset === p.key
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border-strong bg-surface text-foreground hover:bg-surface-subtle'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className={`mt-6 transition-opacity ${loading ? 'opacity-60' : ''}`}>
        {!data ? (
          <p className="text-sm text-muted-foreground">Could not load analytics for this range.</p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard label="Orders" value={ordersTotal} hint="Excludes cancelled orders" />
              <StatCard label="Order value" value={money(orderValueTotal)} hint="Billed total, before refunds" />
              <StatCard label="Collected" value={money(collectedTotal)} hint="Gross payments, before refunds" />
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <Panel title="Orders by source">
                {data.orders_by_source.length === 0 ? (
                  <EmptyState message="No orders in this range." />
                ) : (
                  <ul>
                    {data.orders_by_source.map((o) => (
                      <ProportionRow
                        key={o.source}
                        label={SOURCE_LABEL[o.source] ?? o.source}
                        value={o.orders}
                        total={ordersTotal}
                      />
                    ))}
                  </ul>
                )}
              </Panel>

              <Panel title="Collected by payment method">
                {data.payment_method_mix.length === 0 ? (
                  <EmptyState message="No payments in this range." />
                ) : (
                  <ul>
                    {data.payment_method_mix.map((m) => (
                      <ProportionRow
                        key={m.method}
                        label={METHOD_LABEL[m.method] ?? m.method}
                        value={m.amount}
                        total={collectedTotal}
                        formatValue={money}
                      />
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          </>
        )}
      </div>
    </Page>
  )
}
