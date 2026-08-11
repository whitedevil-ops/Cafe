import type { Metadata } from 'next'
import { createClient } from '@/utils/supabase/server'
import { NotAuthorized } from '@/components/platform-admin/not-authorized'
import CafesClient, { type CafeRow } from './cafes-client'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Cafés' }

export default async function AllCafes() {
  const supabase = await createClient()
  const { data: context } = await supabase.rpc('platform_admin_context')
  const permissions = (context as { permissions: Record<string, boolean> } | null)?.permissions ?? {}
  if (!permissions['cafes.view']) return <NotAuthorized section="cafés" />

  const { data } = await supabase.rpc('op_list_cafes', {})

  return <CafesClient initialCafes={(data ?? []) as CafeRow[]} />
}
