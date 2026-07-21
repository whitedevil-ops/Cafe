import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import FloorClient, { type FloorTable } from './floor-client'

export const dynamic = 'force-dynamic'

export default async function TablesFloorPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()
  const { data } = await supabase
    .from('cafe_tables')
    .select('id, label, capacity, status')
    .eq('cafe_id', cafe.cafeId)

  return <FloorClient cafeId={cafe.cafeId} initialTables={(data ?? []) as FloorTable[]} />
}
