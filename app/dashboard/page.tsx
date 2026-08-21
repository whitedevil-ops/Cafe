import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { hasFeature } from '@/lib/entitlements'
import { createClient } from '@/utils/supabase/server'
import DashboardClient, { type CommandCenterData, type DailySummary } from './dashboard-client'
import { businessDayStartISO, businessDaysAgoStartISO, DEFAULT_TIMEZONE } from '@/lib/datetime'

export const dynamic = 'force-dynamic'

export async function loadCommandCenterData(
  cafeId: string,
  timezone: string = DEFAULT_TIMEZONE,
): Promise<CommandCenterData> {
  const supabase = await createClient()
  const dayStart = businessDayStartISO(timezone)
  const lateThreshold = new Date(Date.now() - 8 * 60 * 1000).toISOString()

  const [
    { count: itemCount },
    todayOrders,
    cancelledToday,
    lateTickets,
    billRequested,
    callWaiter,
    occupiedSessions,
    { count: totalTables },
    payments,
    atRisk,
    { count: newCustomers },
    latestShift,
    cafeRow,
    lowStock,
    { count: staffCount },
    { count: everOrderCount },
    crmAllowed,
    inventoryAllowed,
  ] = await Promise.all([
    supabase.from('menu_items').select('*', { count: 'exact', head: true }).eq('cafe_id', cafeId),
    supabase.from('orders').select('total, status').eq('cafe_id', cafeId).gte('created_at', dayStart).neq('status', 'cancelled'),
    supabase.from('orders').select('id, short_code, cancel_reason').eq('cafe_id', cafeId).eq('status', 'cancelled').gte('created_at', dayStart),
    supabase.from('orders').select('*', { count: 'exact', head: true }).eq('cafe_id', cafeId).in('status', ['placed', 'preparing', 'ready']).lt('created_at', lateThreshold),
    supabase.from('table_sessions').select('*', { count: 'exact', head: true }).eq('cafe_id', cafeId).eq('status', 'bill_requested'),
    supabase.from('notifications').select('table_id').eq('cafe_id', cafeId).eq('type', 'call_waiter').eq('read', false),
    supabase.from('table_sessions').select('table_id').eq('cafe_id', cafeId).in('status', ['active', 'bill_requested']),
    supabase.from('cafe_tables').select('*', { count: 'exact', head: true }).eq('cafe_id', cafeId),
    supabase.from('payments').select('method, amount').eq('cafe_id', cafeId).gte('created_at', dayStart),
    supabase.from('v_customer_stats').select('name, total_spend').eq('cafe_id', cafeId).eq('segment', 'at_risk').order('total_spend', { ascending: false }),
    supabase.from('customers').select('*', { count: 'exact', head: true }).eq('cafe_id', cafeId).gte('first_seen', dayStart),
    supabase.from('cash_shifts').select('id, status, difference, opened_at, closed_at').eq('cafe_id', cafeId).order('opened_at', { ascending: false }).limit(1),
    supabase.from('cafes').select('cash_management_enabled, gst_registered, gstin, upi_id, online_payments_enabled').eq('id', cafeId).maybeSingle(),
    supabase.rpc('low_stock_items', { p_cafe_id: cafeId }),
    supabase.from('cafe_members').select('*', { count: 'exact', head: true }).eq('cafe_id', cafeId),
    supabase.from('orders').select('*', { count: 'exact', head: true }).eq('cafe_id', cafeId).limit(1),
    // v_customer_stats and low_stock_items are plain member-scoped reads with
    // no plan check of their own (unlike e.g. loyalty's RPCs) — the customers
    // and inventory PAGES correctly gate behind these same two flags, but this
    // command-center summary queried both unconditionally, so a café on a
    // plan without CRM or inventory still saw real customer names/spend and
    // stock alerts here. Same bug class as the loyaltyEnabled fix, just found
    // on the home dashboard instead of the POS.
    hasFeature(cafeId, 'crm'),
    hasFeature(cafeId, 'inventory'),
  ])

  const orders = todayOrders.data ?? []
  const revenue = orders.reduce((s, o) => s + (o.total ?? 0), 0)
  const orderCount = orders.length
  const aov = orderCount ? Math.round(revenue / orderCount) : 0

  const collectionsByMethod: Record<string, number> = {}
  for (const p of payments.data ?? []) collectionsByMethod[p.method] = (collectionsByMethod[p.method] ?? 0) + p.amount

  const attentionTables = new Set((callWaiter.data ?? []).map((n) => n.table_id).filter(Boolean))
  const occupiedTables = new Set((occupiedSessions.data ?? []).map((s) => s.table_id)).size

  return {
    hasMenu: (itemCount ?? 0) > 0,
    revenue,
    orderCount,
    aov,
    cancelledToday: (cancelledToday.data ?? []).length,
    cancelledReasons: (cancelledToday.data ?? []).map((o) => o.cancel_reason).filter((r): r is string => !!r),
    lateTickets: lateTickets.count ?? 0,
    billRequestedTables: billRequested.count ?? 0,
    attentionTables: attentionTables.size,
    occupiedTables,
    totalTables: totalTables ?? 0,
    collectionsByMethod,
    atRiskCustomers: crmAllowed ? (atRisk.data ?? []).map((c) => ({ name: c.name, total_spend: c.total_spend })) : [],
    newCustomersToday: newCustomers ?? 0,
    cashEnabled: cafeRow.data?.cash_management_enabled ?? false,
    // Tolerates the RPC not existing yet (migration 0035 unrun) — the
    // dashboard must not break on a café that hasn't migrated.
    lowStockItems: inventoryAllowed ? (lowStock.data ?? []) as { name: string; current_stock: number; min_stock: number; unit: string }[] : [],
    shift: (() => {
      const s = (latestShift.data ?? [])[0]
      if (!s) return null
      return {
        id: s.id as string,
        status: s.status as 'open' | 'closed',
        difference: s.difference as number | null,
        openedAt: s.opened_at as string,
        closedAt: s.closed_at as string | null,
      }
    })(),
    checklist: {
      menuAdded: (itemCount ?? 0) > 0,
      tablesCreated: (totalTables ?? 0) > 0,
      gstConfigured: Boolean(cafeRow.data?.gst_registered && cafeRow.data?.gstin),
      paymentsConfigured: Boolean(cafeRow.data?.upi_id || cafeRow.data?.online_payments_enabled),
      staffAdded: (staffCount ?? 0) > 1,
      qrGenerated: (totalTables ?? 0) > 0,
      testOrderPlaced: (everOrderCount ?? 0) > 0,
    },
    crmAllowed,
    inventoryAllowed,
  }
}

// Deterministic recap of the last CLOSED business day — reuses
// business_overview_report (0057) rather than a second RPC, since "how did
// yesterday go, compared to the day before" is exactly the question that
// report already answers for any range. No AI, no new numbers — just
// yesterday's slice of a report that already exists.
type OverviewReportShape = {
  summary: { net_sales: number; orders: number; aov: number; refunds: number; cancelled_orders: number }
  compare: { net_sales: number; orders: number }
  top_items: { name: string }[]
}

async function loadDailySummary(cafeId: string, timezone: string): Promise<DailySummary | null> {
  const supabase = await createClient()
  const from = businessDaysAgoStartISO(1, timezone)
  const to = businessDayStartISO(timezone)
  const { data, error } = await supabase.rpc('business_overview_report', { p_cafe_id: cafeId, p_from: from, p_to: to })
  if (error || !data) return null
  const r = data as OverviewReportShape
  return {
    netSales: r.summary.net_sales,
    orders: r.summary.orders,
    aov: r.summary.aov,
    refunds: r.summary.refunds,
    cancelledOrders: r.summary.cancelled_orders,
    compareNetSales: r.compare.net_sales,
    compareOrders: r.compare.orders,
    topItem: r.top_items[0]?.name ?? null,
  }
}

export default async function DashboardPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const [data, dailySummary] = await Promise.all([
    loadCommandCenterData(cafe.cafeId, cafe.timezone),
    loadDailySummary(cafe.cafeId, cafe.timezone),
  ])

  if (!data.hasMenu) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{cafe.name}</h1>
        <div className="mt-8 rounded-xl border border-border bg-surface p-8 text-center">
          <h2 className="text-base font-medium text-foreground">Add your first menu item</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Your café has no menu yet. Add items so customers can order from the QR menu.
          </p>
          <Link href="/dashboard/menu" className="mt-5 inline-block rounded-[var(--radius)] bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
            Open menu manager
          </Link>
        </div>
      </div>
    )
  }

  return (
    <DashboardClient
      cafeId={cafe.cafeId}
      cafeName={cafe.name}
      role={cafe.role}
      timezone={cafe.timezone}
      initialData={data}
      dailySummary={dailySummary}
    />
  )
}
