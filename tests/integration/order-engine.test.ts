// Integration tests against the LIVE Brewora demo café, using only the
// public anon key — the same access a real customer's phone has. This is
// deliberate: existence checks (check-schema.sql) already proved these
// functions exist; only actually calling them over the network catches the
// class of bug this project has hit twice this way (an ambiguous column in
// compute_bill, a missing `extensions` schema for pgcrypto) — both invisible
// to a schema-existence check and only found by execution.
//
// These tests write real rows into the live demo café (place_order is not
// mockable — there is no test double for tenant-scoped SQL logic worth
// trusting). Orders are tagged with a distinct phone number and a "vitest:"
// note prefix so they're easy to tell apart from seeded or manual demo data.
import { describe, it, expect, beforeAll } from 'vitest'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!URL || !KEY) {
  throw new Error(
    'NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set. ' +
    'These integration tests need the real project config from .env.local.',
  )
}

const TEST_PHONE = '9000009999' // reserved for this test suite; not used by the seed or manual testing

async function rest(path: string) {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    headers: { apikey: KEY!, Authorization: `Bearer ${KEY}` },
  })
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}: ${await res.text()}`)
  return res.json()
}

type RpcBody = {
  message?: string
  total?: number
  receipt_token?: string
  ok?: boolean
  throttled?: boolean
  order?: { subtotal?: number; tax?: number; service_charge?: number; total?: number }
  items?: { qty?: number }[]
}

async function rpc(fn: string, body: Record<string, unknown>): Promise<{ ok: boolean; body: RpcBody }> {
  const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: KEY!, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok, body: json as RpcBody }
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

describe('order engine — live integration against the Brewora demo café', () => {
  let cafeId: string
  let tableTokens: string[]
  let cappuccinoId: string
  let basePrice: number
  let largeVariantId: string
  let largeDelta: number
  let addonId: string
  let addonPrice: number

  beforeAll(async () => {
    // Only the public columns are anon-readable since migration 0049 (F-02);
    // the café's tax rate is no longer exposed to anon — and does not need to
    // be, because the engine returns authoritative totals we assert against.
    const cafes = await rest(`cafes?select=id&name=eq.Brewora%20Caf%C3%A9`)
    if (!cafes[0]) {
      throw new Error('Brewora Café not found — run supabase/seed-demo-cafe.sql first.')
    }
    cafeId = cafes[0].id

    const tables = await rest(`cafe_tables?select=token&cafe_id=eq.${cafeId}`)
    if (tables.length < 2) throw new Error('Need at least 2 seeded tables for these tests.')
    tableTokens = tables.map((t: { token: string }) => t.token)

    const items = await rest(`menu_items?select=id,price&cafe_id=eq.${cafeId}&name=eq.Cappuccino`)
    if (!items[0]) throw new Error('Cappuccino not found in the demo menu — has the seed changed?')
    cappuccinoId = items[0].id
    basePrice = items[0].price

    const variants = await rest(`menu_item_variants?select=id,price_delta&menu_item_id=eq.${cappuccinoId}&name=eq.Large`)
    if (!variants[0]) throw new Error('Large Cappuccino variant not found.')
    largeVariantId = variants[0].id
    largeDelta = variants[0].price_delta

    const addons = await rest(`menu_item_addons?select=id,price&menu_item_id=eq.${cappuccinoId}&name=eq.Extra%20Espresso%20Shot`)
    if (!addons[0]) throw new Error('Extra Espresso Shot add-on not found.')
    addonId = addons[0].id
    addonPrice = addons[0].price
  })

  it('prices consistently end to end through place_order + get_receipt', async () => {
    const qty = 2
    const unit = basePrice + largeDelta + addonPrice
    const subtotal = unit * qty // from anon-readable menu prices

    const placed = await rpc('place_order', {
      p_token: pick(tableTokens),
      p_items: [{ item_id: cappuccinoId, qty, variant_id: largeVariantId, addon_ids: [addonId], note: 'vitest: extra hot, no sugar' }],
      p_phone: TEST_PHONE,
      p_payment_method: 'counter',
    })

    expect(placed.ok).toBe(true)
    expect(typeof placed.body.receipt_token).toBe('string')

    const receipt = await rpc('get_receipt', { p_token: placed.body.receipt_token })
    expect(receipt.ok).toBe(true)
    const o = receipt.body.order
    expect(o).toBeDefined()

    // Server computed the subtotal from menu prices (never the client).
    expect(o?.subtotal).toBe(subtotal)
    // The order engine and the receipt read path agree on the total.
    expect(placed.body.total).toBe(o?.total)
    // Bill arithmetic is internally consistent: subtotal + tax + svc = total,
    // with a non-negative, server-derived tax — without exposing the rate.
    expect(o?.tax ?? 0).toBeGreaterThanOrEqual(0)
    expect((o?.subtotal ?? 0) + (o?.tax ?? 0) + (o?.service_charge ?? 0)).toBe(o?.total)
    expect(receipt.body.items?.[0]?.qty).toBe(qty)
  })

  it('rejects an order missing a required variant instead of silently mispricing it', async () => {
    const { ok, body } = await rpc('place_order', {
      p_token: pick(tableTokens),
      p_items: [{ item_id: cappuccinoId, qty: 1 }],
      p_payment_method: 'counter',
    })
    expect(ok).toBe(false)
    expect(body.message).toMatch(/variant required/)
  })

  // Tenant-isolation proxy: the demo project's second café ("tt") has no
  // seeded menu items, so there's no genuine cross-tenant item id available
  // to test against. A well-formed but nonexistent id exercises the exact
  // same `cafe_id = v_cafe_id` filter a real cross-tenant id would hit — one
  // step short of a true two-tenant proof, but the same code path.
  it('rejects an item id that does not resolve under this café (tenant-scope filter)', async () => {
    const { ok, body } = await rpc('place_order', {
      p_token: pick(tableTokens),
      p_items: [{ item_id: '00000000-0000-4000-a000-000000000099', qty: 1 }],
      p_payment_method: 'counter',
    })
    expect(ok).toBe(false)
    expect(body.message).toMatch(/item not available/)
  })

  it('rejects an invalid table token on place_order and call_waiter alike', async () => {
    const order = await rpc('place_order', {
      p_token: 'vitest-not-a-real-token',
      p_items: [{ item_id: cappuccinoId, qty: 1, variant_id: largeVariantId }],
      p_payment_method: 'counter',
    })
    expect(order.ok).toBe(false)
    expect(order.body.message).toMatch(/invalid table/)

    const waiter = await rpc('call_waiter', { p_token: 'vitest-not-a-real-token' })
    expect(waiter.body.message).toMatch(/invalid table/)
  })

  it('call_waiter and request_bill work on a freshly-opened session, and request_bill throttles a repeat within 2 minutes', async () => {
    const token = pick(tableTokens)

    const placed = await rpc('place_order', {
      p_token: token,
      p_items: [{ item_id: cappuccinoId, qty: 1, variant_id: largeVariantId }],
      p_payment_method: 'counter',
    })
    expect(placed.ok).toBe(true)

    const waiter = await rpc('call_waiter', { p_token: token })
    expect(waiter.body.ok).toBe(true)

    const firstBillRequest = await rpc('request_bill', { p_token: token })
    expect(firstBillRequest.body.ok).toBe(true)

    const secondBillRequest = await rpc('request_bill', { p_token: token })
    expect(secondBillRequest.body.ok).toBe(true)
    expect(secondBillRequest.body.throttled).toBe(true)
  })
})
