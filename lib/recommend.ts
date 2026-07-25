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
// call, zero ongoing cost. Used to suggest category pairings for the owner to
// review (after import, or on demand from the Menu page); never auto-activated
// without the owner applying it.
//
// Vocabulary and pairing rules below reflect well-known F&B cross-sell
// patterns (QSR/café upsell research): a drink alongside a main is the
// single highest-converting add-on; a side is the next most common; dessert
// paired with a hot beverage (coffee/tea + cake/cookie/brownie) is a
// distinct, especially strong pairing in café settings specifically, so it's
// scored as its own rule rather than folded into the generic drink↔dessert one.
const MAIN_WORDS = [
  'pizza', 'burger', 'pasta', 'biryani', 'momo', 'dosa', 'thali', 'roll', 'sandwich',
  'noodle', 'rice', 'wrap', 'burrito', 'taco', 'sub', 'panini', 'kebab', 'kabab', 'tikka',
  'curry', 'maggi', 'paratha', 'uttapam', 'idli', 'poha', 'chowmein', 'hakka', 'manchurian',
  'meal', 'combo', 'platter', 'bowl', 'frankie', 'shawarma', 'pav', 'vada', 'khichdi',
]
const SIDE_WORDS = [
  'side', 'fries', 'bread', 'dip', 'sauce', 'chutney', 'raita', 'papad', 'salad',
  'nachos', 'wings', 'starter', 'appetizer', 'garlic bread', 'potato', 'crispy',
]
const DRINK_WORDS = [
  'drink', 'beverage', 'coffee', 'tea', 'juice', 'shake', 'soda', 'cola', 'lassi',
  'mojito', 'lemonade', 'smoothie', 'cooler', 'mocktail', 'buttermilk', 'chaas',
  'cappuccino', 'latte', 'espresso', 'americano', 'frappe', 'sharbat', 'nimbu', 'thandai', 'cold coffee',
]
const HOT_DRINK_WORDS = ['coffee', 'tea', 'latte', 'cappuccino', 'espresso', 'americano', 'chai']
const DESSERT_WORDS = [
  'dessert', 'sweet', 'cookie', 'brownie', 'cake', 'ice cream', 'kulfi', 'gulab jamun',
  'rasmalai', 'halwa', 'kheer', 'pastry', 'waffle', 'donut', 'mousse', 'pudding', 'tiramisu',
]

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
  const hotDrinks = categories.filter((c) => matches(c.name, HOT_DRINK_WORDS))
  const desserts = categories.filter((c) => matches(c.name, DESSERT_WORDS))

  for (const m of mains) {
    for (const d of drinks) out.push({ categoryId: m.id, suggestedCategoryId: d.id, reason: 'beverage pairing' })
    for (const s of sides) out.push({ categoryId: m.id, suggestedCategoryId: s.id, reason: 'complementary side' })
    for (const de of desserts) out.push({ categoryId: m.id, suggestedCategoryId: de.id, reason: 'save room for dessert' })
  }
  // A snack/side on its own commonly wants a drink alongside it too.
  for (const s of sides) {
    for (const d of drinks) out.push({ categoryId: s.id, suggestedCategoryId: d.id, reason: 'beverage pairing' })
  }
  // Coffee/tea + something sweet is its own strong, café-specific pairing —
  // distinct from (and usually stronger than) the generic drink↔dessert link.
  for (const d of hotDrinks) {
    for (const de of desserts) out.push({ categoryId: d.id, suggestedCategoryId: de.id, reason: 'classic pairing with a hot drink' })
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
