import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import TablesClient, { type TableRow } from '../tables-client'

export const dynamic = 'force-dynamic'

export default async function ManageTablesPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()
  const { data } = await supabase
    .from('cafe_tables')
    .select('id, label, capacity, status, token')
    .eq('cafe_id', cafe.cafeId)
    .order('label')

  return (
    <div>
      <div className="mx-auto max-w-5xl px-6 pt-6">
        <Link href="/dashboard/tables" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to floor view
        </Link>
      </div>
      <TablesClient cafeId={cafe.cafeId} slug={cafe.slug} initialTables={(data ?? []) as TableRow[]} />
    </div>
  )
}
