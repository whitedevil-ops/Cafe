// Server-side cache for the customer-facing QR menu's café-scoped data
// (cafe row, categories, items, variants, addons, popular-items) — this is
// identical for every table at a given café, so without caching, N diners
// scanning N different table QRs at the same café each trigger their own
// full set of Supabase queries. Wrapped once per café instead.
//
// Uses a plain anon-key client, not the cookie-bound one from
// utils/supabase/server — unstable_cache forbids calling cookies()/headers()
// inside its cached scope, and this data is public anyway (same RLS a real
// customer request gets, just reused across requests).
//
// Freshness has two layers, because `revalidate: 30` alone does NOT mean "never
// older than 30s": unstable_cache is stale-while-revalidate, so the first
// request after the window still receives the OLD data (and only triggers the
// refresh that later requests see). Measured on a production build: a size
// price edited in the database kept being served for 34s, and after a 45s
// quiet spell the first diner still got the old price. For a café nobody scans
// for an hour, "30s" was really "until the second scan".
//   1. Each café's entry carries a per-café tag (menuCacheTag). Every menu
//      write in the dashboard calls app/api/menu/revalidate afterwards, which
//      EXPIRES that tag, so the very next load rebuilds from the database.
//   2. `revalidate: 30` stays as the backstop for writes that don't go through
//      that endpoint (scripts, SQL, platform-operator tools).
// The wrapper is built per call, with the café id in the key and the tag, so
// one café's edit never evicts another café's menu.
import { unstable_cache } from 'next/cache'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Combo, ComboSlot } from '@/lib/combos'
import { menuCacheTag } from '@/lib/menu-cache-tag'

function createAnonClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

export type CachedCafeMenu = {
  cafe: {
    name: string; logo_url: string | null; upsell_threshold: number | null
    accept_pay_counter: boolean | null; online_payments_enabled: boolean | null; razorpay_status: string | null
    timezone: string | null
  } | null
  categories: { id: string; name: string; sort: number }[]
  items: {
    id: string; name: string; description: string | null; price: number; image_url: string | null
    category_id: string; is_veg: boolean; is_bestseller: boolean; is_upsell: boolean
    upsell_pitch: string | null; available: boolean; created_at: string
    offer_price: number | null; offer_days: number[] | null
  }[]
  variants: { id: string; menu_item_id: string; name: string; price_delta: number }[]
  addons: { id: string; menu_item_id: string; name: string; price: number }[]
  combos: Combo[]
  comboSlots: ComboSlot[]
  popularIds: string[]
}

export function getCachedCafeMenu(cafeId: string): Promise<CachedCafeMenu> {
  return unstable_cache(
    async (): Promise<CachedCafeMenu> => {
      const supabase = createAnonClient()

      const [{ data: cafe }, { data: categories }, { data: items }, { data: combos }] = await Promise.all([
        supabase.from('cafes').select('name, logo_url, upsell_threshold, accept_pay_counter, online_payments_enabled, razorpay_status, timezone').eq('id', cafeId).maybeSingle(),
        supabase.from('menu_categories').select('id, name, sort').eq('cafe_id', cafeId).order('sort'),
        supabase
          .from('menu_items')
          .select('id, name, description, price, image_url, category_id, is_veg, is_bestseller, is_upsell, upsell_pitch, available, created_at, offer_price, offer_days')
          .eq('cafe_id', cafeId)
          .eq('archived', false)
          .order('sort'),
        supabase.from('combos').select('id, name, description, price, image_url, active, sort')
          .eq('cafe_id', cafeId).eq('active', true).order('sort'),
      ])

      const itemIds = (items ?? []).map((i) => i.id)
      const comboIds = (combos ?? []).map((c) => c.id)
      const [{ data: variants }, { data: addons }, { data: comboSlots }, { data: popular }] = await Promise.all([
        itemIds.length
          ? supabase.from('menu_item_variants').select('id, menu_item_id, name, price_delta').in('menu_item_id', itemIds).order('sort')
          : Promise.resolve({ data: [] }),
        itemIds.length
          ? supabase.from('menu_item_addons').select('id, menu_item_id, name, price').in('menu_item_id', itemIds).order('sort')
          : Promise.resolve({ data: [] }),
        comboIds.length
          ? supabase.from('combo_slots').select('*').in('combo_id', comboIds).order('sort')
          : Promise.resolve({ data: [] }),
        supabase.rpc('public_popular_items', { p_cafe_id: cafeId, p_limit: 12 }),
      ])

      const availableIds = new Set((items ?? []).filter((i) => i.available).map((i) => i.id))
      const popularIds = ((popular ?? []) as { menu_item_id: string }[])
        .map((p) => p.menu_item_id)
        .filter((id) => availableIds.has(id))

      return {
        cafe: cafe ?? null,
        categories: (categories ?? []) as CachedCafeMenu['categories'],
        items: (items ?? []) as CachedCafeMenu['items'],
        variants: (variants ?? []) as CachedCafeMenu['variants'],
        addons: (addons ?? []) as CachedCafeMenu['addons'],
        combos: (combos ?? []) as Combo[],
        comboSlots: (comboSlots ?? []) as ComboSlot[],
        popularIds,
      }
    },
    ['qr-menu-data', cafeId],
    { revalidate: 30, tags: [menuCacheTag(cafeId)] },
  )()
}
