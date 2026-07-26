import { notFound } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { getCachedCafeMenu } from '@/lib/menu-cache'
import MenuClient, { type PublicItem, type Variant, type Addon } from './menu-client'

export const dynamic = 'force-dynamic'

export default async function TablePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = await createClient() // anon context — public read policies apply

  // Table lookup and the ordering kill-switch stay live/uncached (per-table,
  // cheap, and need to react immediately) — only the café-wide menu data
  // below (identical for every table at this café) is cached.
  const { data: table, error: tableErr } = await supabase
    .from('cafe_tables')
    .select('id, label, cafe_id')
    .eq('token', token)
    .maybeSingle()
  if (tableErr) console.error('[qr] cafe_tables lookup failed:', tableErr.message, 'token=', token)
  if (!table) notFound()

  const { cafe, categories, items, variants, addons, popularIds } = await getCachedCafeMenu(table.cafe_id)
  if (!cafe) notFound()

  // Operator-facing kill switch (platform-admin Feature control), separate
  // from account Suspend/Disable — this pauses only customer ordering while
  // staff keep dashboard access. Any RPC error (including this function not
  // existing yet, mid-deploy) is treated as enabled: never let a lookup
  // hiccup take a working café's ordering offline.
  const { data: orderingEnabled, error: orderingErr } = await supabase.rpc('public_cafe_ordering_enabled', {
    p_table_token: token,
  })
  if (orderingEnabled === false && !orderingErr) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Ordering is paused</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {cafe.name} isn&apos;t taking orders through this QR code right now. Please check with staff.
        </p>
      </main>
    )
  }

  return (
    <MenuClient
      // Forces a full remount whenever the table token changes, so cart,
      // order confirmation, and the session gate can never carry over from
      // a previous table — without this React may reuse the component
      // instance (same position in the tree) across a token change and
      // keep its old state alive.
      key={token}
      token={token}
      cafeId={table.cafe_id}
      cafeName={cafe.name}
      cafeLogo={cafe.logo_url}
      tableLabel={table.label}
      onlinePaymentsEnabled={(cafe.online_payments_enabled ?? false) && cafe.razorpay_status === 'connected'}
      acceptPayCounter={cafe.accept_pay_counter ?? true}
      upsellThreshold={cafe.upsell_threshold ?? 150}
      categories={(categories ?? []) as { id: string; name: string }[]}
      items={(items ?? []) as PublicItem[]}
      variants={(variants ?? []) as Variant[]}
      addons={(addons ?? []) as Addon[]}
      popularIds={popularIds}
    />
  )
}
