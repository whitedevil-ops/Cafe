import type { SupabaseClient } from '@supabase/supabase-js'

// Smart cross-sell — thin, fail-safe client wrapper over the get_recommendations
// RPC. The engine is entirely server-side (deterministic, no external AI). Every
// call here is defensive: if recommendations are slow, error, or disabled, the
// caller gets an empty list and ordering continues unaffected (spec §20).

export type Recommendation = { id: string; name: string; price: number; reason: string }

export async function fetchRecommendations(
  supabase: SupabaseClient,
  cafeId: string,
  itemIds: string[],
  limit = 4,
): Promise<Recommendation[]> {
  if (!cafeId || itemIds.length === 0) return []
  try {
    const { data, error } = await supabase.rpc('get_recommendations', {
      p_cafe_id: cafeId,
      p_item_ids: itemIds,
      p_limit: limit,
    })
    if (error || !Array.isArray(data)) return []
    return data as Recommendation[]
  } catch {
    return []
  }
}

// ── Setup-time suggestion heuristic (spec §3, §18) ──────────────────────────
// Purely deterministic keyword matching on category names — NOT AI, no external
// call, zero ongoing cost. Used only to suggest category pairings for the
// owner to review after import; never auto-activated.
const MAIN_WORDS = ['pizza', 'burger', 'pasta', 'biryani', 'momo', 'dosa', 'thali', 'roll', 'sandwich', 'noodle', 'rice', 'wrap']
const SIDE_WORDS = ['side', 'fries', 'bread', 'dip', 'sauce', 'chutney', 'raita']
const DRINK_WORDS = ['drink', 'beverage', 'coffee', 'tea', 'juice', 'shake', 'soda', 'cola', 'lassi']
const DESSERT_WORDS = ['dessert', 'sweet', 'cookie', 'brownie', 'cake', 'ice cream']

function matches(name: string, words: string[]): boolean {
  const s = name.toLowerCase()
  return words.some((w) => s.includes(w))
}

export type CategorySuggestion = { categoryId: string; suggestedCategoryId: string; reason: string }

export function suggestCategoryPairings(categories: { id: string; name: string }[]): CategorySuggestion[] {
  const out: CategorySuggestion[] = []
  const mains = categories.filter((c) => matches(c.name, MAIN_WORDS))
  const sides = categories.filter((c) => matches(c.name, SIDE_WORDS))
  const drinks = categories.filter((c) => matches(c.name, DRINK_WORDS))
  const desserts = categories.filter((c) => matches(c.name, DESSERT_WORDS))

  for (const m of mains) {
    for (const s of sides) out.push({ categoryId: m.id, suggestedCategoryId: s.id, reason: 'complementary side' })
    for (const d of drinks) out.push({ categoryId: m.id, suggestedCategoryId: d.id, reason: 'beverage pairing' })
  }
  // Coffee/tea commonly pairs with a light bite.
  for (const d of drinks) {
    for (const de of desserts) out.push({ categoryId: d.id, suggestedCategoryId: de.id, reason: 'commonly ordered together' })
  }
  return out
}

// Analytics — impression / add. Fire-and-forget; never awaited on the ordering
// path, and swallows every error so a logging hiccup can't affect the customer.
export function logRecommendationEvent(
  supabase: SupabaseClient,
  cafeId: string,
  suggestedItemId: string,
  kind: 'impression' | 'add',
  source?: string,
): void {
  try {
    void supabase
      .rpc('log_recommendation_event', {
        p_cafe_id: cafeId,
        p_suggested_item_id: suggestedItemId,
        p_kind: kind,
        p_source: source ?? null,
      })
      .then(() => {}, () => {})
  } catch {
    /* ignore */
  }
}
