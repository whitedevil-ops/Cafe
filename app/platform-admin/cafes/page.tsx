import { createClient } from '@/utils/supabase/server'
import CafesClient, { type CafeRow } from './cafes-client'

export const dynamic = 'force-dynamic'

export default async function AllCafes() {
  const supabase = await createClient()
  const { data } = await supabase.rpc('op_list_cafes', {})

  return <CafesClient initialCafes={(data ?? []) as CafeRow[]} />
}
