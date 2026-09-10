import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import { hasFeature } from '@/lib/entitlements'
import ExpensesClient, { type Expense } from './expenses-client'
import { businessDaysAgoStartISO } from '@/lib/datetime'

export const dynamic = 'force-dynamic'

export default async function ExpensesPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()

  if (!(await hasFeature(cafe.cafeId, 'expenses'))) {
    redirect('/dashboard')
  }

  // FOUND LIVE (full-product audit, 2026-09-10): this comment was stale/
  // incorrect — record_expense and delete_expense (supabase/migrations/
  // 0167_fix_record_expense_method_cast.sql, 0166_phase1_security_
  // lockdown_part4.sql) are both owner/manager-only at the RPC level, not
  // "any active member." ExpensesClient never received the role prop this
  // page's siblings (loyalty, coupons, reservations) all use to hide/disable
  // admin-only controls, so any role granted this screen — 'accountant' gets
  // it by default — saw a fully interactive "Log an expense" form and Delete
  // buttons that always failed with an RPC exception.
  const since = businessDaysAgoStartISO(89, cafe.timezone).slice(0, 10)
  const { data } = await supabase
    .from('expenses')
    .select('id, category, amount, vendor, method, notes, spent_on, created_at')
    .eq('cafe_id', cafe.cafeId)
    .gte('spent_on', since)
    .order('spent_on', { ascending: false })

  return <ExpensesClient cafeId={cafe.cafeId} role={cafe.role} initialExpenses={(data ?? []) as Expense[]} />
}
