import { notFound } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import MyOrdersClient from './my-orders-client'
import { DEFAULT_TIMEZONE } from '@/lib/datetime'

export const dynamic = 'force-dynamic'

export default async function MyOrdersPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = await createClient()

  // See app/t/[token]/page.tsx — the token column is revoked from anon in
  // migration 0132, so the lookup goes through a SECURITY DEFINER resolver.
  const { data: resolved } = await supabase.rpc('resolve_table_token', { p_token: token })
  const table = resolved as { label: string; cafe_id: string; cafe_name: string; timezone: string } | null
  if (!table) notFound()

  const cafe = { name: table.cafe_name, timezone: table.timezone }

  return (
    <MyOrdersClient
      token={token}
      cafeId={table.cafe_id}
      cafeName={cafe?.name ?? 'Café'}
      tableLabel={table.label}
      timezone={cafe?.timezone ?? DEFAULT_TIMEZONE}
    />
  )
}
