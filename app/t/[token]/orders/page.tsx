import { notFound } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import MyOrdersClient from './my-orders-client'
import { DEFAULT_TIMEZONE } from '@/lib/datetime'

export const dynamic = 'force-dynamic'

export default async function MyOrdersPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = await createClient()

  const { data: table } = await supabase
    .from('cafe_tables')
    .select('label, cafes(name, timezone)')
    .eq('token', token)
    .maybeSingle()
  if (!table) notFound()

  const cafe = Array.isArray(table.cafes) ? table.cafes[0] : table.cafes

  return (
    <MyOrdersClient
      token={token}
      cafeName={cafe?.name ?? 'Café'}
      tableLabel={table.label}
      timezone={cafe?.timezone ?? DEFAULT_TIMEZONE}
    />
  )
}
