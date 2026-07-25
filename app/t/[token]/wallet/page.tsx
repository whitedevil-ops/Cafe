import { notFound } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { DEFAULT_TIMEZONE } from '@/lib/datetime'
import WalletClient from './wallet-client'

export const dynamic = 'force-dynamic'

export default async function CustomerWalletPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = await createClient()

  const { data: table } = await supabase
    .from('cafe_tables')
    .select('label, cafe_id, cafes(name, logo_url, timezone)')
    .eq('token', token)
    .maybeSingle()
  if (!table) notFound()

  const cafe = Array.isArray(table.cafes) ? table.cafes[0] : table.cafes

  const { data: tiers } = await supabase
    .from('wallet_topup_tiers')
    .select('id, pay_amount, credit_amount')
    .eq('cafe_id', table.cafe_id)
    .eq('active', true)
    .order('sort')

  return (
    <WalletClient
      token={token}
      cafeId={table.cafe_id}
      cafeName={cafe?.name ?? 'Café'}
      cafeLogo={cafe?.logo_url ?? null}
      tableLabel={table.label}
      timezone={cafe?.timezone ?? DEFAULT_TIMEZONE}
      tiers={tiers ?? []}
    />
  )
}
