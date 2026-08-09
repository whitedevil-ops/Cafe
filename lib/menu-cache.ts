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
// revalidate: 30s is a deliberate bounded-staleness tradeoff, not a "close
// enough forever" cache — a staff member marking an item sold out becomes
// visible to customers within 30s worst case, in exchange for cutting
// repeat-scan DB load during a service rush. No tag-based invalidation yet
// (unstable_cache's tags are fixed at wrap time, not per-café), so a menu
// edit doesn't invalidate this early — if 30s ever proves too slow for a
// specific edit (e.g. a price correction), shorten `revalidate` rather than
// building per-café tag invalidation for a small café's edit frequency.
import { unstable_cache } from 'next/cache'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Combo, ComboSlot } from '@/lib/combos'

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
  } | null
  categories: { id: string; name: string; sort: number }[]
  items: {
    id: string; name: string; description: string | null; price: number; image_url: string | null
    category_id: string; is_veg: boolean; is_bestseller: boolean; is_upsell: boolean
    upsell_pitch: string | null; available: boolean; created_at: string
  }[]
  variants: { id: string; menu_item_id: string; name: string; price_delta: number }[]
  addons: { id: string; menu_item_id: string; name: string; price: number }[]
  combos: Combo[]
  comboSlots: ComboSlot[]
  popularIds: string[]
}

export const getCachedCafeMenu = unstable_cache(
  async (cafeId: string): Promise<CachedCafeMenu> => {
    const supabase = createAnonClient()

    const [{ data: cafe }, { data: categories }, { data: items }, { data: combos }] = await Promise.all([
      supabase.from('cafes').select('name, logo_url, upsell_threshold, accept_pay_counter, online_payments_enabled, razorpay_status').eq('id', cafeId).maybeSingle(),
      supabase.from('menu_categories').select('id, name, sort').eq('cafe_id', cafeId).order('sort'),
      supabase
        .from('menu_items')
        .select('id, name, description, price, image_url, category_id, is_veg, is_bestseller, is_upsell, upsell_pitch, available, created_at')
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
  ['qr-menu-data'],
  { revalidate: 30 },
)
