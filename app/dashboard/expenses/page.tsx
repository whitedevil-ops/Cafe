import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import ExpensesClient, { type Expense } from './expenses-client'
import { businessDaysAgoStartISO } from '@/lib/datetime'

export const dynamic = 'force-dynamic'

export default async function ExpensesPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()
  // RLS ("member all" on expenses, schema.sql) already lets any active café
  // member manage expenses — that's an existing, deliberate product
  // decision, not something introduced or narrowed here.
  const since = businessDaysAgoStartISO(89, cafe.timezone).slice(0, 10)
  const { data } = await supabase
    .from('expenses')
    .select('id, category, amount, vendor, method, notes, spent_on, created_at')
    .eq('cafe_id', cafe.cafeId)
    .gte('spent_on', since)
    .order('spent_on', { ascending: false })

  return <ExpensesClient cafeId={cafe.cafeId} initialExpenses={(data ?? []) as Expense[]} />
}
