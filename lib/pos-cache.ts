// Server-side cache for POS's café-scoped MENU CATALOG only (categories,
// items, variants, addons, combos, combo slots) — the ~14-query bulk of the
// ~17-query fetch POS performed on every single navigation into it (full-
// product performance audit, 2026-09-10), even though this data barely
// changes mid-shift compared with order activity.
//
// Deliberately NOT cached here: cafe_tables/floor_areas (table `status` is
// live), rewards, entitlement resolution, and the active spin wheel — see
// app/dashboard/pos/page.tsx, which fetches those fresh on every request.
//
// Mirrors lib/menu-cache.ts's exact shape and the same reasoning for using a
// plain anon-key client rather than the cookie-bound one from
// utils/supabase/server — unstable_cache forbids calling cookies()/headers()
// inside its cached scope. Confirmed safe: this selects the exact same
// columns (or a subset) that migration 0140_close_menu_cost_exposure.sql
// explicitly re-granted to anon after closing the food-cost leak — tax_percent,
// is_bestseller and created_at are all in that grant list; cost/cost_source
// (never selected here) are the columns that migration revoked from anon.
// offer_price/offer_days are already anon-read in production via this exact
// table through lib/menu-cache.ts's own select.
//
// revalidate: 30s is the same deliberate bounded-staleness tradeoff
// lib/menu-cache.ts already uses for this identical category of data — a
// menu edit reaches POS within 30s worst case, in exchange for not needing
// tag-based invalidation wired through every menu-editing mutation site
// (which are all direct client-to-Supabase writes, not Server
// Actions/Route Handlers — revalidateTag only works from those).
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

export type CachedPosCatalog = {
  categories: { id: string; name: string; sort: number }[]
  items: {
    id: string; name: string; price: number; image_url: string | null; is_veg: boolean
    is_bestseller: boolean; category_id: string | null; available: boolean; created_at: string
    tax_percent: number | null; offer_price: number | null; offer_days: number[] | null
  }[]
  variants: { id: string; menu_item_id: string; name: string; price_delta: number }[]
  addons: { id: string; menu_item_id: string; name: string; price: number }[]
  combos: Combo[]
  comboSlots: ComboSlot[]
}

export function getCachedPosCatalog(cafeId: string): Promise<CachedPosCatalog> {
  return unstable_cache(
    async (): Promise<CachedPosCatalog> => {
      const supabase = createAnonClient()

      const [{ data: categories }, { data: items }, { data: combos }] = await Promise.all([
        supabase.from('menu_categories').select('id, name, sort').eq('cafe_id', cafeId).order('sort'),
        supabase
          .from('menu_items')
          .select('id, name, price, image_url, is_veg, is_bestseller, category_id, available, created_at, tax_percent, offer_price, offer_days')
          .eq('cafe_id', cafeId)
          .eq('archived', false)
          .order('sort'),
        supabase.from('combos').select('id, name, description, price, image_url, active, sort')
          .eq('cafe_id', cafeId).eq('active', true).order('sort'),
      ])

      const itemIds = (items ?? []).map((i) => i.id)
      const comboIds = (combos ?? []).map((c) => c.id)
      const [{ data: variants }, { data: addons }, { data: comboSlots }] = await Promise.all([
        itemIds.length
          ? supabase.from('menu_item_variants').select('id, menu_item_id, name, price_delta').in('menu_item_id', itemIds).order('sort')
          : Promise.resolve({ data: [] }),
        itemIds.length
          ? supabase.from('menu_item_addons').select('id, menu_item_id, name, price').in('menu_item_id', itemIds).order('sort')
          : Promise.resolve({ data: [] }),
        comboIds.length
          ? supabase.from('combo_slots').select('*').in('combo_id', comboIds).order('sort')
          : Promise.resolve({ data: [] }),
      ])

      return {
        categories: (categories ?? []) as CachedPosCatalog['categories'],
        items: (items ?? []) as CachedPosCatalog['items'],
        variants: (variants ?? []) as CachedPosCatalog['variants'],
        addons: (addons ?? []) as CachedPosCatalog['addons'],
        combos: (combos ?? []) as Combo[],
        comboSlots: (comboSlots ?? []) as ComboSlot[],
      }
    },
    ['pos-catalog', cafeId],
    { revalidate: 30 },
  )()
}
