import { describe, it, expect } from 'vitest'
import { suggestCategoryPairings } from '@/lib/recommend'

// Deterministic keyword heuristic used for the OPTIONAL post-import review
// step (spec §3/§18) — no AI, no external call, zero ongoing cost.
describe('suggestCategoryPairings', () => {
  it('pairs a main-course category with sides and drinks', () => {
    const cats = [
      { id: 'pizza', name: 'Pizzas' },
      { id: 'sides', name: 'Sides & Dips' },
      { id: 'drinks', name: 'Soft Drinks' },
    ]
    const out = suggestCategoryPairings(cats)
    expect(out.some((s) => s.categoryId === 'pizza' && s.suggestedCategoryId === 'sides')).toBe(true)
    expect(out.some((s) => s.categoryId === 'pizza' && s.suggestedCategoryId === 'drinks')).toBe(true)
  })

  it('never suggests a category pairs with itself', () => {
    const cats = [{ id: 'a', name: 'Burgers' }]
    expect(suggestCategoryPairings(cats)).toEqual([])
  })

  it('produces nothing when there is no recognizable relationship', () => {
    const cats = [{ id: 'a', name: 'Misc' }, { id: 'b', name: 'Specials' }]
    expect(suggestCategoryPairings(cats)).toEqual([])
  })
})
