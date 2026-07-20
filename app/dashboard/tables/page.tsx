import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import TablesClient, { type TableRow } from './tables-client'

export const dynamic = 'force-dynamic'

export default async function TablesPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()
  const { data } = await supabase
    .from('cafe_tables')
    .select('id, label, capacity, status, token')
    .eq('cafe_id', cafe.cafeId)
    .order('label')

  return (
    <TablesClient
      cafeId={cafe.cafeId}
      slug={cafe.slug}
      initialTables={(data ?? []) as TableRow[]}
    />
  )
}
