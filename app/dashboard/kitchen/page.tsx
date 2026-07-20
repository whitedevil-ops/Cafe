import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import KitchenClient from './kitchen-client'

export const dynamic = 'force-dynamic'

export default async function KitchenPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()
  const { data: tables } = await supabase
    .from('cafe_tables')
    .select('id, label')
    .eq('cafe_id', cafe.cafeId)

  const tableLabels: Record<string, string> = {}
  for (const t of tables ?? []) tableLabels[t.id] = t.label

  return <KitchenClient cafeId={cafe.cafeId} tableLabels={tableLabels} />
}
