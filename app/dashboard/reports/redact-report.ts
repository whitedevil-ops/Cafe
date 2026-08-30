export type OverviewReport = {
  summary: {
    gross_sales: number
    discounts: number
    refunds: number
    net_sales: number
    tax: number
    collected: number
    outstanding: number
    orders: number
    aov: number
    customers: number
    cancelled_orders: number
  }
  compare: { from: string; to: string; net_sales: number; orders: number; refunds: number }
  by_type: { type: string; gross_sales: number; orders: number }[]
  by_source: { source: string; gross_sales: number; orders: number }[]
  by_payment_method: { method: string; amount: number }[]
  by_day: { date: string; sales: number; orders: number }[]
  by_hour: { hour: number; sales: number; orders: number }[]
  top_items: { name: string; qty: number; gross_sales: number }[]
  top_categories: { category: string; gross_sales: number }[]
  top_customers: { name: string; phone_masked: string; orders: number; spend: number }[]
  attention: { outstanding_amount: number; refunds_amount: number; cancelled_orders: number; low_stock_count: number }
}

// business_overview_report() checks only is_cafe_member(), same as the two
// already-fixed v_customer_stats/low_stock_items leaks — top_customers is the
// same CRM-analytics shape (name + spend, ranked) as v_customer_stats, and
// attention.low_stock_count comes straight from the low_stock_items RPC. Both
// need the plan gate the RPC itself never applies.
//
// Lives in a plain module (no 'use client') so both page.tsx's server-side
// initial load and overview-client.tsx's client-side load() can call it
// directly and apply the exact same redaction instead of drifting — a Server
// Component cannot invoke a function that lives in a 'use client' module.
export function redactReport(report: OverviewReport | null, crmAllowed: boolean, inventoryAllowed: boolean): OverviewReport | null {
  if (!report) return null
  return {
    ...report,
    top_customers: crmAllowed ? report.top_customers : [],
    attention: { ...report.attention, low_stock_count: inventoryAllowed ? report.attention.low_stock_count : 0 },
  }
}
