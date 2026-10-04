import { describe, it, expect } from 'vitest'
import { PostgrestClient } from '@supabase/postgrest-js'
import { planOptionWrites, type AddonInput, type VariantInput } from '@/lib/menu-options'

// Regression guard for the bug where NO new size or add-on could be saved from
// the item editor (introduced 2026-09-09 in 3d6ca22, found 2026-10-04).
//
// The editor built new rows as `{ ...row, id: undefined }`. supabase-js derives
// a bulk insert's `?columns=` list from the rows' KEYS, and an `undefined` value
// is dropped from the JSON body but its key is still counted — so PostgREST was
// told to insert NULL into the primary key, and the whole insert failed with
// `null value in column "id" … violates not-null constraint`. The delete and
// upsert steps before it had already run, leaving the item half saved, and the
// error only surfaced in a banner hidden behind the editor's overlay.

/** What supabase-js would put in `?columns=` for these rows — no network involved. */
function columnsParam(rows: object[]): string[] {
  const builder = new PostgrestClient('http://localhost:54321/rest/v1')
    .from('menu_item_variants')
    .insert(rows as never) as unknown as { url: URL }
  return (builder.url.searchParams.get('columns') ?? '').split(',').map((c) => c.replace(/"/g, ''))
}

const ITEM = 'item-1'
const v = (name: string, price: string, extra: Partial<VariantInput> = {}): VariantInput => ({ name, price, margin: '', ...extra })
const a = (name: string, price: string, extra: Partial<AddonInput> = {}): AddonInput => ({ name, price, ...extra })

describe('library behaviour the editor must never trigger again', () => {
  it('counts an undefined-valued key as a column — which is why `id: undefined` was fatal', () => {
    // If a future postgrest-js stops doing this, this test fails and the extra
    // care in planOptionWrites can be relaxed deliberately rather than by accident.
    expect(columnsParam([{ name: 'SMALL', id: undefined }])).toContain('id')
  })
})

describe('planOptionWrites — new rows', () => {
  it('builds new variants WITHOUT an id key, so no `id` column is sent', () => {
    const { variants } = planOptionWrites({
      itemId: ITEM, basePrice: 179, baseCost: 0,
      variants: [v('SMALL', '129'), v('REGULAR', '179'), v('LARGE', '269')], addons: [],
    })
    expect(variants.insert).toHaveLength(3)
    for (const row of variants.insert) {
      expect('id' in row).toBe(false)
      expect(Object.values(row).every((x) => x !== undefined)).toBe(true)
    }
    expect(columnsParam(variants.insert)).not.toContain('id')
    expect(variants.update).toEqual([])
    expect(variants.keepIds).toEqual([])
  })

  it('builds new add-ons WITHOUT an id key as well', () => {
    const { addons } = planOptionWrites({
      itemId: ITEM, basePrice: 100, baseCost: 0, variants: [], addons: [a('EXTRA CHEESE', '30'), a('DIP', '0')],
    })
    expect(addons.insert).toHaveLength(2)
    for (const row of addons.insert) expect('id' in row).toBe(false)
    expect(columnsParam(addons.insert)).not.toContain('id')
  })

  it('stores each size as a delta from the base price (SMALL 129 / REGULAR 179 / LARGE 269 on a 179 item)', () => {
    const { variants } = planOptionWrites({
      itemId: ITEM, basePrice: 179, baseCost: 0,
      variants: [v('SMALL', '129'), v('REGULAR', '179'), v('LARGE', '269')], addons: [],
    })
    expect(variants.insert.map((r) => [r.name, r.price_delta, r.sort])).toEqual([
      ['SMALL', -50, 0],
      ['REGULAR', 0, 1],
      ['LARGE', 90, 2],
    ])
    expect(variants.insert.every((r) => r.menu_item_id === ITEM)).toBe(true)
  })

  it('turns a typed margin into a cost delta against the base cost', () => {
    // base ₹179 with ₹100 margin => costs 79; LARGE ₹269 keeping ₹100 costs 169 => +90
    const { variants } = planOptionWrites({
      itemId: ITEM, basePrice: 179, baseCost: 79, variants: [v('LARGE', '269', { margin: '100' })], addons: [],
    })
    expect(variants.insert[0]).toMatchObject({ price_delta: 90, cost_delta: 90 })
  })

  it('leaves cost unchanged (delta 0) when no margin is given', () => {
    const { variants } = planOptionWrites({
      itemId: ITEM, basePrice: 179, baseCost: 79, variants: [v('LARGE', '269')], addons: [],
    })
    expect(variants.insert[0].cost_delta).toBe(0)
  })
})

describe('planOptionWrites — existing rows keep their ids', () => {
  it('upserts rows that already have an id and lists them as the ones to keep', () => {
    const { variants, addons } = planOptionWrites({
      itemId: ITEM, basePrice: 149, baseCost: 0,
      variants: [v('REGULAR', '149', { id: 'v-1' }), v('LARGE', '239', { id: 'v-2' })],
      addons: [a('EXTRA CHEESE', '30', { id: 'a-1' })],
    })
    expect(variants.update.map((r) => r.id)).toEqual(['v-1', 'v-2'])
    expect(variants.keepIds).toEqual(['v-1', 'v-2'])
    expect(variants.insert).toEqual([])
    expect(addons.update.map((r) => r.id)).toEqual(['a-1'])
    expect(addons.keepIds).toEqual(['a-1'])
  })

  it('handles a mixed edit — rename, reprice and add a size in one save', () => {
    const { variants } = planOptionWrites({
      itemId: ITEM, basePrice: 149, baseCost: 0,
      variants: [v('REG', '149', { id: 'v-1' }), v('LARGE', '259', { id: 'v-2' }), v('SMALL', '99')],
    addons: [],
    })
    expect(variants.update.map((r) => [r.id, r.name, r.price_delta, r.sort])).toEqual([
      ['v-1', 'REG', 0, 0],
      ['v-2', 'LARGE', 110, 1],
    ])
    expect(variants.insert.map((r) => [r.name, r.price_delta, r.sort])).toEqual([['SMALL', -50, 2]])
    expect(columnsParam(variants.insert)).not.toContain('id')
    // …and the update rows DO carry theirs, uniformly, so the upsert's column list is stable
    expect(columnsParam(variants.update)).toContain('id')
  })

  it('an empty list keeps nothing, so every stored row for the item is deleted', () => {
    const { variants, addons } = planOptionWrites({ itemId: ITEM, basePrice: 100, baseCost: 0, variants: [], addons: [] })
    expect(variants.keepIds).toEqual([])
    expect(addons.keepIds).toEqual([])
  })
})

describe('planOptionWrites — what gets dropped or clamped', () => {
  it('skips unnamed rows and numbers sort over the rows that remain', () => {
    const { variants } = planOptionWrites({
      itemId: ITEM, basePrice: 100, baseCost: 0,
      variants: [v('  ', '50'), v('SMALL', '80'), v('', '90'), v('LARGE', '120')], addons: [],
    })
    expect(variants.insert.map((r) => [r.name, r.sort])).toEqual([['SMALL', 0], ['LARGE', 1]])
  })

  it('trims names, rounds prices, and never stores a negative add-on price', () => {
    const { addons } = planOptionWrites({
      itemId: ITEM, basePrice: 100, baseCost: 0, variants: [], addons: [a('  DIP  ', '-5'), a('SAUCE', '12.6'), a('MAYO', '')],
    })
    expect(addons.insert.map((r) => [r.name, r.price])).toEqual([['DIP', 0], ['SAUCE', 13], ['MAYO', 0]])
  })

  it('does not mutate what the editor passed in', () => {
    const input = [v('SMALL', '129')]
    const snapshot = JSON.stringify(input)
    planOptionWrites({ itemId: ITEM, basePrice: 179, baseCost: 0, variants: input, addons: [] })
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})
