import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { hasFeature } from '@/lib/entitlements'
import { byTableLabel } from '@/lib/table-sort'
import { createClient } from '@/utils/supabase/server'
import PosClient from './pos-client'
import type { PosCategory } from '@/components/pos/category-tabs'
import type { PosItem } from '@/components/pos/product-card'
import type { PosTable, PosArea } from '@/components/pos/cart-panel'
import type { Combo, ComboSlot } from '@/lib/combos'

export const dynamic = 'force-dynamic'

export type PosVariant = { id: string; menu_item_id: string; name: string; price_delta: number }
export type PosAddon = { id: string; menu_item_id: string; name: string; price: number }

export default async function PosPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()
  const [{ data: cafeRow }, { data: categories }, { data: items }, { data: tables }, { data: areas }, { data: rewards }] = await Promise.all([
    supabase.from('cafes').select('tax_percent, service_charge, dine_in, takeaway, loyalty_enabled, gst_registered, tax_inclusive').eq('id', cafe.cafeId).single(),
    supabase.from('menu_categories').select('id, name, sort').eq('cafe_id', cafe.cafeId).order('sort'),
    supabase
      .from('menu_items')
      .select('id, name, price, image_url, is_veg, is_bestseller, category_id, available, created_at, tax_percent, offer_price, offer_days')
      .eq('cafe_id', cafe.cafeId)
      .eq('archived', false)
      .order('sort'),
    supabase
      .from('cafe_tables')
      .select('id, label, status, capacity, area_id')
      .eq('cafe_id', cafe.cafeId)
      .eq('archived', false),
    supabase.from('floor_areas').select('id, name, sort').eq('cafe_id', cafe.cafeId).eq('archived', false).order('sort'),
    // A reward with no linked item is still valid (0121) — redeeming it
    // falls back to the original standalone redeem_reward RPC (deduct
    // points, staff hand it over themselves) instead of a cart line.
    supabase
      .from('rewards')
      .select('id, name, points_cost, menu_item_id, variant_id')
      .eq('cafe_id', cafe.cafeId)
      .eq('active', true)
      .order('points_cost'),
  ])

  const itemIds = (items ?? []).map((i) => i.id)
  const [{ data: variants }, { data: addons }, { data: combos }] = await Promise.all([
    itemIds.length
      ? supabase.from('menu_item_variants').select('id, menu_item_id, name, price_delta').in('menu_item_id', itemIds).order('sort')
      : Promise.resolve({ data: [] }),
    itemIds.length
      ? supabase.from('menu_item_addons').select('id, menu_item_id, name, price').in('menu_item_id', itemIds).order('sort')
      : Promise.resolve({ data: [] }),
    supabase.from('combos').select('id, name, description, price, image_url, active, sort')
      .eq('cafe_id', cafe.cafeId).eq('active', true).order('sort'),
  ])

  const comboIds = (combos ?? []).map((c) => c.id)
  const { data: comboSlots } = comboIds.length
    ? await supabase.from('combo_slots').select('*').in('combo_id', comboIds).order('sort')
    : { data: [] }

  const withOptions = new Set([...(variants ?? []).map((v) => v.menu_item_id), ...(addons ?? []).map((a) => a.menu_item_id)])

  // menu_item_id -> its own GST rate. Mirrors the snapshot trigger in 0106,
  // which stamps each order line with coalesce(menu_items.tax_percent,
  // cafes.tax_percent) — so the cart preview resolves the rate the same way
  // the bill will, instead of applying one flat café rate to every line.
  const itemTaxRates: Record<string, number | null> = {}
  for (const i of items ?? []) {
    itemTaxRates[i.id] = i.tax_percent === null || i.tax_percent === undefined ? null : Number(i.tax_percent)
  }

  // Plan entitlements, resolved server-side. hasFeature() applies the same
  // override-beats-plan-default precedence the rest of the app uses, so a
  // café granted loyalty by an operator override is treated as entitled even
  // if its plan would not normally include it.
  const [loyaltyAllowed, couponsAllowed, spinAllowed, { data: activeWheel }] = await Promise.all([
    hasFeature(cafe.cafeId, 'loyalty'),
    hasFeature(cafe.cafeId, 'coupons'),
    // Spin has been its own entitlement since 0204, and this is where the
    // guest's won code is actually spent. Asking about 'loyalty' here meant a
    // café that bought Spin without Loyalty handed out codes it had no field
    // to type back in — see the note on spinEnabled below.
    hasFeature(cafe.cafeId, 'spin'),
    // The wheel row IS the on/off switch — there is no cafes.spin_enabled
    // column. A café with no wheel, or an archived one, should not show a
    // spin-code box that can only ever say "no such code".
    supabase.from('spin_wheels').select('id').eq('cafe_id', cafe.cafeId).eq('active', true).maybeSingle(),
  ])

  const posItems: (PosItem & { category_id: string | null })[] = (items ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    price: i.price,
    image_url: i.image_url,
    is_veg: i.is_veg,
    tax_percent: i.tax_percent === null || i.tax_percent === undefined ? null : Number(i.tax_percent),
    is_bestseller: i.is_bestseller,
    hasOptions: withOptions.has(i.id),
    available: i.available,
    category_id: i.category_id,
    created_at: i.created_at,
    offer_price: i.offer_price,
    offer_days: i.offer_days,
  }))

  const posCategories: PosCategory[] = (categories ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    count: posItems.filter((i) => i.category_id === c.id).length,
  }))

  // POS reuses the canonical cafe_tables/floor_areas — the SAME layout the owner
  // configures in Floor & Table Setup. No separate POS table source.
  const posTables: PosTable[] = (tables ?? [])
    .map((t) => ({
      id: t.id,
      label: t.label,
      occupied: t.status === 'occupied',
      capacity: t.capacity ?? null,
      area_id: t.area_id ?? null,
    }))
    .sort(byTableLabel)

  const posAreas: PosArea[] = (areas ?? []).map((a) => ({ id: a.id, name: a.name }))

  return (
    <PosClient
      cafeId={cafe.cafeId}
      role={cafe.role}
      timezone={cafe.timezone}
      taxPercent={Number(cafeRow?.tax_percent ?? 0)}
      // A café that is not GST registered is charged NO tax by the server,
      // and that is the default state — without these two the cart preview
      // quoted a total the printed bill disagreed with.
      gstRegistered={cafeRow?.gst_registered ?? false}
      taxInclusive={cafeRow?.tax_inclusive ?? false}
      itemTaxRates={itemTaxRates}
      serviceChargePercent={Number(cafeRow?.service_charge ?? 0)}
      dineIn={cafeRow?.dine_in ?? true}
      takeaway={cafeRow?.takeaway ?? true}
      categories={posCategories}
      items={posItems}
      variants={(variants ?? []) as PosVariant[]}
      addons={(addons ?? []) as PosAddon[]}
      tables={posTables}
      areas={posAreas}
      // Both conditions are required: the plan decides whether a café MAY have
      // the feature, the toggle decides whether they WANT it on right now.
      // FOUND LIVE: this line still only checked the toggle, not the plan —
      // a café downgraded from Scale to Starter kept showing customer points
      // and reward pills in the POS (server-side redemption correctly
      // rejected it as "not in this plan", but nothing stopped the dead-end
      // UI from showing in the first place). spinEnabled right below already
      // had the correct fix; this line was the one spot it never reached.
      loyaltyEnabled={loyaltyAllowed && (cafeRow?.loyalty_enabled ?? false)}
      // FOUND LIVE 2026-09-02: this was a copy of the line above, so the
      // "Spin code" box at the till appeared only when LOYALTY was on. After
      // 0204 split Spin out as its own feature, both cafés running a wheel had
      // loyalty off — so guests were winning codes the counter had no way to
      // accept. One had already handed out a 15%-off code with nowhere to
      // redeem it. Gated on the spin entitlement and a live wheel now, which
      // is the same pair the guest's own wheel is gated on.
      spinEnabled={spinAllowed && Boolean(activeWheel)}
      couponsEnabled={couponsAllowed}
      rewards={rewards ?? []}
      combos={(combos ?? []) as Combo[]}
      comboSlots={(comboSlots ?? []) as ComboSlot[]}
    />
  )
}
