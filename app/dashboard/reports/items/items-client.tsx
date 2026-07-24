'use client'

import { downloadReport, type SheetSpec } from '@/lib/xlsx-export'
import { ReportsSubnav, ReportHeader, RangePicker, Section, List, useReportRange } from '../_shared'

export type ItemsReport = {
  summary: { total_gross_sales: number; distinct_items_sold: number }
  items: { menu_item_id: string | null; name: string; qty: number; gross_sales: number; orders: number; avg_price: number }[]
  categories: { category: string; qty: number; gross_sales: number; share_pct: number }[]
  unsold_items: { menu_item_id: string; name: string; category: string }[]
}

export default function ItemsClient({
  cafeId,
  cafeName,
  role,
  timezone,
  initialFrom,
  initialTo,
  initialReport,
}: {
  cafeId: string
  cafeName: string
  role: string
  timezone: string
  initialFrom: string
  initialTo: string
  initialReport: ItemsReport | null
}) {
  const canSeeProfit = role === 'owner' || role === 'manager'
  const { report, loading, error, preset, choosePreset, customFrom, setCustomFrom, customTo, setCustomTo, applyCustom, activeRange } =
    useReportRange<ItemsReport>({ cafeId, timezone, rpc: 'items_categories_report', initialFrom, initialTo, initialReport })

  function exportExcel() {
    if (!report) return
    const { from, to } = activeRange()
    const sheets: SheetSpec[] = [
      {
        name: 'Items', title: 'Item sales',
        columns: [
          { header: 'Item', key: 'name', kind: 'text' },
          { header: 'Qty sold', key: 'qty', kind: 'qty' },
          { header: 'Gross Sales (₹)', key: 'gross_sales', kind: 'money' },
          { header: 'Orders', key: 'orders', kind: 'qty' },
          { header: 'Avg price (₹)', key: 'avg_price', kind: 'money' },
        ],
        rows: report.items,
      },
      {
        name: 'Categories', title: 'Category mix',
        columns: [
          { header: 'Category', key: 'category', kind: 'text' },
          { header: 'Qty sold', key: 'qty', kind: 'qty' },
          { header: 'Gross Sales (₹)', key: 'gross_sales', kind: 'money' },
          { header: 'Share %', key: 'share_pct', kind: 'pct' },
        ],
        rows: report.categories,
      },
      {
        name: 'Unsold', title: 'Live menu items with zero sales in range',
        columns: [{ header: 'Item', key: 'name', kind: 'text' }, { header: 'Category', key: 'category', kind: 'text' }],
        rows: report.unsold_items,
      },
    ]
    downloadReport({ cafeName, reportName: 'Items-Categories', from, to }, sheets)
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <ReportsSubnav active="/dashboard/reports/items" canSeeProfit={canSeeProfit} />
      <ReportHeader
        title="Items & Categories"
        subtitle="What's selling, what isn't, and how your menu's categories split — volume and mix, not margin."
        links={[]}
        onExport={exportExcel}
        canExport={Boolean(report)}
      />
      <RangePicker preset={preset} choosePreset={choosePreset} customFrom={customFrom} setCustomFrom={setCustomFrom} customTo={customTo} setCustomTo={setCustomTo} applyCustom={applyCustom} />

      {error && <p className="mt-4 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">{error}</p>}

      {loading ? (
        <p className="mt-8 text-sm text-muted-foreground">Loading…</p>
      ) : !report ? (
        <p className="mt-8 text-sm text-muted-foreground">No data for this range.</p>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[12.5px] text-muted-foreground">Total gross sales</p>
              <p className="mt-1 text-xl font-semibold tracking-tight text-foreground">₹{report.summary.total_gross_sales.toLocaleString('en-IN')}</p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-[12.5px] text-muted-foreground">Distinct items sold</p>
              <p className="mt-1 text-xl font-semibold tracking-tight text-foreground">{report.summary.distinct_items_sold}</p>
            </div>
          </div>

          <Section title="Category mix">
            <List rows={report.categories.map((c) => ({ label: `${c.category} (${c.share_pct}%)`, value: c.gross_sales }))} />
          </Section>

          <Section title={`All items sold (${report.items.length})`}>
            {report.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing sold in this range.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[12px] uppercase tracking-wide text-muted-foreground">
                      <th className="pb-2 font-medium">Item</th>
                      <th className="pb-2 text-right font-medium">Qty</th>
                      <th className="pb-2 text-right font-medium">Orders</th>
                      <th className="pb-2 text-right font-medium">Avg price</th>
                      <th className="pb-2 text-right font-medium">Gross sales</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {report.items.map((i) => (
                      <tr key={i.menu_item_id ?? i.name}>
                        <td className="py-1.5 text-foreground">{i.name}</td>
                        <td className="py-1.5 text-right text-foreground">{i.qty}</td>
                        <td className="py-1.5 text-right text-muted-foreground">{i.orders}</td>
                        <td className="py-1.5 text-right text-muted-foreground">₹{i.avg_price}</td>
                        <td className="py-1.5 text-right font-medium text-foreground">₹{i.gross_sales.toLocaleString('en-IN')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {report.unsold_items.length > 0 && (
            <Section title={`Live menu items with zero sales (${report.unsold_items.length})`}>
              <p className="mb-3 text-[13px] text-muted-foreground">Available on your menu right now, but nobody ordered them in this range — worth a second look.</p>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {report.unsold_items.map((u) => (
                  <li key={u.menu_item_id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate text-foreground">{u.name}</span>
                    <span className="shrink-0 text-[12px] text-muted-foreground">{u.category}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
    </div>
  )
}
