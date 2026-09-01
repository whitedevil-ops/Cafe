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
  // Via RPC rather than a direct .eq('token', …): the token column is revoked
  // from anon in migration 0132 because it was world-readable, and a WHERE
  // reference needs column SELECT privilege. resolve_table_token is SECURITY
  // DEFINER and reads it as the definer.
  const { data: resolved, error: tableErr } = await supabase.rpc('resolve_table_token', { p_token: token })
  if (tableErr) console.error('[qr] resolve_table_token failed:', tableErr.message, 'token=', token)
  const table = resolved as { table_id: string; label: string; cafe_id: string } | null
  if (!table) notFound()

  // The menu fetch needs table.cafe_id, but the coupons/ordering checks below
  // only need the raw token (they resolve cafe_id internally) — none of the
  // three depend on each other, so run them concurrently instead of behind
  // one another.
  const [menu, couponsResult, orderingResult] = await Promise.all([
    getCachedCafeMenu(table.cafe_id),
    // cafe_has_feature() itself is revoked from anon (a real security
    // boundary) — this narrow, anon-safe RPC is the only way this page can
    // know whether to show the coupon field at all, instead of always
    // rendering it and letting resolve_coupon_discount's raw rejection
    // message be the first thing a real customer sees.
    supabase.rpc('public_cafe_coupons_enabled', { p_table_token: token }),
    // Operator-facing kill switch (operator console Feature control), separate
    // from account Suspend/Disable — this pauses only customer ordering while
    // staff keep dashboard access. Any RPC error (including this function not
    // existing yet, mid-deploy) is treated as enabled: never let a lookup
    // hiccup take a working café's ordering offline.
    supabase.rpc('public_cafe_ordering_enabled', { p_table_token: token }),
  ])
  const { cafe, categories, items, variants, addons, combos, comboSlots, popularIds } = menu
  if (!cafe) notFound()

  const { data: couponsEnabled } = couponsResult
  const { data: orderingEnabled, error: orderingErr } = orderingResult
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
      cafeTimezone={cafe.timezone ?? 'Asia/Kolkata'}
      tableLabel={table.label}
      onlinePaymentsEnabled={(cafe.online_payments_enabled ?? false) && cafe.razorpay_status === 'connected'}
      acceptPayCounter={cafe.accept_pay_counter ?? true}
      couponsEnabled={couponsEnabled ?? false}
      upsellThreshold={cafe.upsell_threshold ?? 150}
      categories={(categories ?? []) as { id: string; name: string }[]}
      items={(items ?? []) as PublicItem[]}
      variants={(variants ?? []) as Variant[]}
      addons={(addons ?? []) as Addon[]}
      combos={combos ?? []}
      comboSlots={comboSlots ?? []}
      popularIds={popularIds}
    />
  )
}
