import { notFound } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { DEFAULT_TIMEZONE } from '@/lib/datetime'
import WalletClient from './wallet-client'

export const dynamic = 'force-dynamic'

export default async function CustomerWalletPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = await createClient()

  // See app/t/[token]/page.tsx — the token column is revoked from anon in
  // migration 0132, so the lookup goes through a SECURITY DEFINER resolver.
  const { data: resolved } = await supabase.rpc('resolve_table_token', { p_token: token })
  const table = resolved as
    | { label: string; cafe_id: string; cafe_name: string; logo_url: string | null; timezone: string }
    | null
  if (!table) notFound()

  const cafe = { name: table.cafe_name, logo_url: table.logo_url, timezone: table.timezone }

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
