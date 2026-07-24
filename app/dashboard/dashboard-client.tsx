'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Clock, Users, Ban, CheckCircle2, Wallet, PackageMinus } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { businessDayStartISO } from '@/lib/datetime'
import { OnboardingChecklist } from '@/components/dashboard/onboarding-checklist'

export type CommandCenterData = {
  hasMenu: boolean
  revenue: number
  orderCount: number
  aov: number
  cancelledToday: number
  cancelledReasons: string[]
  lateTickets: number
  billRequestedTables: number
  attentionTables: number
  occupiedTables: number
  totalTables: number
  collectionsByMethod: Record<string, number>
  atRiskCustomers: { name: string | null; total_spend: number }[]
  newCustomersToday: number
  cashEnabled: boolean
  lowStockItems: { name: string; current_stock: number; min_stock: number; unit: string }[]
  shift: {
    id: string
    status: 'open' | 'closed'
    difference: number | null
    openedAt: string
    closedAt: string | null
  } | null
  checklist: {
    menuAdded: boolean
    tablesCreated: boolean
    gstConfigured: boolean
    paymentsConfigured: boolean
    staffAdded: boolean
    qrGenerated: boolean
    testOrderPlaced: boolean
  }
}

export default function DashboardClient({
  cafeId,
  cafeName,
  role,
  timezone,
  initialData,
}: {
  cafeId: string
  cafeName: string
  role: string
  timezone: string
  initialData: CommandCenterData
}) {
  const supabase = useMemo(() => createClient(), [])
  const [data, setData] = useState(initialData)
  const [lastPolledAt, setLastPolledAt] = useState<Date | null>(null)
  const [money, setMoney] = useState<{ collected: number; outstanding: number; refunded: number; unpaid_orders: number; unpaid_dine_in: number; unpaid_takeaway: number } | null>(null)

  const poll = useCallback(async () => {
    const dayStart = businessDayStartISO(timezone)
    const lateThreshold = new Date(Date.now() - 8 * 60 * 1000).toISOString()

    const [todayOrders, cancelledToday, lateTickets, billRequested, callWaiter, occupiedSessions, { count: totalTables }, payments, atRisk, { count: newCustomers }, latestShift, cashSetting, lowStock] =
      await Promise.all([
        supabase.from('orders').select('total, status').eq('cafe_id', cafeId).gte('created_at', dayStart).neq('status', 'cancelled'),
        supabase.from('orders').select('id, cancel_reason').eq('cafe_id', cafeId).eq('status', 'cancelled').gte('created_at', dayStart),
        supabase.from('orders').select('*', { count: 'exact', head: true }).eq('cafe_id', cafeId).in('status', ['placed', 'preparing', 'ready']).lt('created_at', lateThreshold),
        supabase.from('table_sessions').select('*', { count: 'exact', head: true }).eq('cafe_id', cafeId).eq('status', 'bill_requested'),
        supabase.from('notifications').select('table_id').eq('cafe_id', cafeId).eq('type', 'call_waiter').eq('read', false),
        supabase.from('table_sessions').select('table_id').eq('cafe_id', cafeId).in('status', ['active', 'bill_requested']),
        supabase.from('cafe_tables').select('*', { count: 'exact', head: true }).eq('cafe_id', cafeId),
        supabase.from('payments').select('method, amount').eq('cafe_id', cafeId).gte('created_at', dayStart),
        supabase.from('v_customer_stats').select('name, total_spend').eq('cafe_id', cafeId).eq('segment', 'at_risk').order('total_spend', { ascending: false }),
        supabase.from('customers').select('*', { count: 'exact', head: true }).eq('cafe_id', cafeId).gte('first_seen', dayStart),
        supabase.from('cash_shifts').select('id, status, difference, opened_at, closed_at').eq('cafe_id', cafeId).order('opened_at', { ascending: false }).limit(1),
        supabase.from('cafes').select('cash_management_enabled').eq('id', cafeId).maybeSingle(),
        supabase.rpc('low_stock_items', { p_cafe_id: cafeId }),
      ])

    const orders = todayOrders.data ?? []
    const revenue = orders.reduce((s, o) => s + (o.total ?? 0), 0)
    const orderCount = orders.length
    const collectionsByMethod: Record<string, number> = {}
    for (const p of payments.data ?? []) collectionsByMethod[p.method] = (collectionsByMethod[p.method] ?? 0) + p.amount
    const attentionTables = new Set((callWaiter.data ?? []).map((n) => n.table_id).filter(Boolean))
    const occupiedTables = new Set((occupiedSessions.data ?? []).map((s) => s.table_id)).size

    setData((prev) => ({
      hasMenu: true,
      revenue,
      orderCount,
      aov: orderCount ? Math.round(revenue / orderCount) : 0,
      cancelledToday: (cancelledToday.data ?? []).length,
      cancelledReasons: (cancelledToday.data ?? []).map((o) => o.cancel_reason).filter((r): r is string => !!r),
      lateTickets: lateTickets.count ?? 0,
      billRequestedTables: billRequested.count ?? 0,
      attentionTables: attentionTables.size,
      occupiedTables,
      totalTables: totalTables ?? 0,
      collectionsByMethod,
      atRiskCustomers: (atRisk.data ?? []).map((c) => ({ name: c.name, total_spend: c.total_spend })),
      newCustomersToday: newCustomers ?? 0,
      cashEnabled: cashSetting.data?.cash_management_enabled ?? false,
      lowStockItems: (lowStock.data ?? []) as CommandCenterData['lowStockItems'],
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
      checklist: prev.checklist,
    }))
    setLastPolledAt(new Date())
  }, [supabase, cafeId, timezone])

  useEffect(() => {
    const p = setInterval(poll, 30000)
    return () => clearInterval(p)
  }, [poll])

  // Money today: collected vs still-outstanding vs refunded. Its own fetch so
  // a payments RPC hiccup can never take down the rest of the command centre.
  useEffect(() => {
    let alive = true
    const run = async () => {
      const dayStart = businessDayStartISO(timezone)
      const { data: sum } = await supabase.rpc('outstanding_summary', {
        p_cafe_id: cafeId, p_from: dayStart, p_to: new Date().toISOString(),
      })
      if (alive && sum) setMoney(sum as typeof money)
    }
    void run()
    const id = setInterval(run, 30000)
    return () => { alive = false; clearInterval(id) }
  }, [supabase, cafeId, timezone])

  const topCancelReason = useMemo(() => {
    if (data.cancelledReasons.length === 0) return null
    const counts = new Map<string, number>()
    for (const r of data.cancelledReasons) counts.set(r, (counts.get(r) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  }, [data.cancelledReasons])

  const alerts = [
    data.lateTickets > 0 && {
      icon: <Clock size={16} />,
      text: `${data.lateTickets} order${data.lateTickets === 1 ? '' : 's'} running late in the kitchen`,
      href: '/dashboard/kitchen',
      tone: 'destructive' as const,
    },
    (data.billRequestedTables > 0 || data.attentionTables > 0) && {
      icon: <Users size={16} />,
      text: [
        data.billRequestedTables > 0 ? `${data.billRequestedTables} table${data.billRequestedTables === 1 ? '' : 's'} waiting for the bill` : null,
        data.attentionTables > 0 ? `${data.attentionTables} table${data.attentionTables === 1 ? '' : 's'} called for a waiter` : null,
      ].filter(Boolean).join(' · '),
      href: '/dashboard/tables',
      tone: 'warning' as const,
    },
    data.atRiskCustomers.length > 0 && {
      icon: <AlertTriangle size={16} />,
      text: `${data.atRiskCustomers.length} regular${data.atRiskCustomers.length === 1 ? '' : 's'} going quiet${data.atRiskCustomers[0]?.name ? ` — ${data.atRiskCustomers[0].name}${data.atRiskCustomers.length > 1 ? ` +${data.atRiskCustomers.length - 1} more` : ''}` : ''}`,
      href: '/dashboard/customers?segment=at_risk',
      tone: 'warning' as const,
    },
    // A drawer that didn't balance is the single most actionable money signal
    // an owner gets, so it outranks cancellations in the list.
    data.cashEnabled && data.shift?.status === 'closed' && (data.shift.difference ?? 0) !== 0 && {
      icon: <Wallet size={16} />,
      text: `Cash ${(data.shift.difference ?? 0) < 0 ? 'shortage' : 'excess'} of ₹${Math.abs(data.shift.difference ?? 0).toLocaleString('en-IN')} on the last shift`,
      href: '/dashboard/shift',
      tone: 'destructive' as const,
    },
    data.cashEnabled && data.shift?.status === 'open' && {
      icon: <Wallet size={16} />,
      text: 'A cash shift is still open — close it to reconcile the drawer',
      href: '/dashboard/shift',
      tone: 'neutral' as const,
    },
    data.lowStockItems.length > 0 && {
      icon: <PackageMinus size={16} />,
      text: `${data.lowStockItems.length} ingredient${data.lowStockItems.length === 1 ? '' : 's'} below the reorder level — ${data.lowStockItems[0].name}${data.lowStockItems.length > 1 ? ` +${data.lowStockItems.length - 1} more` : ''}`,
      href: '/dashboard/inventory',
      tone: 'warning' as const,
    },
    data.cancelledToday > 0 && {
      icon: <Ban size={16} />,
      text: `${data.cancelledToday} order${data.cancelledToday === 1 ? '' : 's'} cancelled today${topCancelReason ? ` — mostly "${topCancelReason[0]}"` : ''}`,
      href: null,
      tone: 'neutral' as const,
    },
  ].filter((a): a is Exclude<typeof a, false> => a !== false)

  const toneClass: Record<string, string> = {
    destructive: 'border-destructive bg-destructive-subtle text-destructive',
    warning: 'border-warning bg-warning-subtle text-warning',
    neutral: 'border-border bg-surface-subtle text-muted-foreground',
  }

  const metrics = [
    ['Today’s revenue', `₹${data.revenue.toLocaleString('en-IN')}`],
    ['Today’s orders', data.orderCount],
    ['Avg order value', `₹${data.aov}`],
    ['New customers today', data.newCustomersToday],
  ] as const

  const methodLabel: Record<string, string> = { cash: 'Cash', card: 'Card', counter: 'Pending', upi: 'UPI' }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{cafeName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Today at a glance · role <span className="font-medium text-foreground">{role}</span>
          </p>
        </div>
        {lastPolledAt && (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-success">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> Live
          </span>
        )}
      </div>

      <OnboardingChecklist cafeId={cafeId} flags={data.checklist} />

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map(([label, value]) => (
          <Link key={label} href="/dashboard/bills" className="rounded-xl border border-border bg-surface p-5 transition-colors hover:bg-surface-subtle">
            <p className="text-[13px] text-muted-foreground">{label}</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-foreground">{value}</p>
          </Link>
        ))}
      </div>

      {money && (
        <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="text-[12.5px] text-muted-foreground">Billed today</p>
            <p className="mt-0.5 text-xl font-semibold text-foreground">₹{data.revenue.toLocaleString('en-IN')}</p>
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="text-[12.5px] text-muted-foreground">Collected today</p>
            <p className="mt-0.5 text-xl font-semibold text-success">₹{money.collected.toLocaleString('en-IN')}</p>
          </div>
          <Link href="/dashboard/bills?payment=unpaid" className="rounded-xl border border-border bg-surface p-4 transition-colors hover:bg-surface-subtle">
            <p className="text-[12.5px] text-muted-foreground">Outstanding</p>
            <p className={`mt-0.5 text-xl font-semibold ${money.outstanding > 0 ? 'text-destructive' : 'text-foreground'}`}>₹{money.outstanding.toLocaleString('en-IN')}</p>
            {money.outstanding > 0 ? (
              <p className="text-[11px] text-muted-foreground">
                Dine-in ₹{money.unpaid_dine_in.toLocaleString('en-IN')} · Takeaway ₹{money.unpaid_takeaway.toLocaleString('en-IN')}
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">Everything settled</p>
            )}
          </Link>
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="text-[12.5px] text-muted-foreground">Refunded today</p>
            <p className={`mt-0.5 text-xl font-semibold ${money.refunded > 0 ? 'text-warning' : 'text-foreground'}`}>₹{money.refunded.toLocaleString('en-IN')}</p>
          </div>
        </div>
      )}

      <div className="mt-8">
        <p className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">Needs attention</p>
        {alerts.length === 0 ? (
          <div className="mt-2 flex items-center gap-2 rounded-[var(--radius)] border border-success bg-success-subtle px-4 py-3 text-[13.5px] font-medium text-success">
            <CheckCircle2 size={16} /> All clear — nothing needs you right now.
          </div>
        ) : (
          <ul className="mt-2 space-y-2">
            {alerts.map((a, i) => {
              const content = (
                <div className={`flex items-center gap-2.5 rounded-[var(--radius)] border px-4 py-3 text-[13.5px] font-medium transition-colors ${toneClass[a.tone]} ${a.href ? 'hover:opacity-80' : ''}`}>
                  {a.icon}
                  {a.text}
                </div>
              )
              return <li key={i}>{a.href ? <Link href={a.href}>{content}</Link> : content}</li>
            })}
          </ul>
        )}
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="text-[13px] text-muted-foreground">Tables occupied</p>
          <p className="mt-1 text-2xl font-semibold text-foreground">
            {data.occupiedTables} <span className="text-base font-normal text-muted-foreground">/ {data.totalTables}</span>
          </p>
          <Link href="/dashboard/tables" className="mt-2 inline-block text-[12.5px] text-primary hover:underline">View floor →</Link>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="text-[13px] text-muted-foreground">Collected today</p>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {Object.keys(data.collectionsByMethod).length === 0 ? (
              <p className="text-2xl font-semibold text-foreground">₹0</p>
            ) : (
              Object.entries(data.collectionsByMethod).map(([method, amount]) => (
                <p key={method} className="text-[15px] font-semibold text-foreground">
                  ₹{amount.toLocaleString('en-IN')} <span className="text-[12px] font-normal text-muted-foreground">{methodLabel[method] ?? method}</span>
                </p>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
