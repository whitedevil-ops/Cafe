'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Search, X, BellRing, ReceiptText, ClipboardList, ArrowLeft } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { FoodCard, type QrItem } from '@/components/qr/food-card'
import { OfflineBanner } from '@/components/offline-banner'
import { ItemSheet, type QrVariant, type QrAddon } from '@/components/qr/item-sheet'

export type PublicItem = QrItem
export type Variant = QrVariant
export type Addon = QrAddon

const PHONE_RE = /^[6-9]\d{9}$/
const NEW_ITEM_DAYS = 14
const POPULAR = '__popular'

type Line = {
  key: string
  itemId: string
  name: string
  variantId: string | null
  addonIds: string[]
  modLabel: string
  note: string
  unitPrice: number
  qty: number
}

export default function MenuClient({
  token,
  cafeName,
  cafeLogo,
  tableLabel,
  upiEnabled,
  qrPaymentMode,
  upsellThreshold,
  categories,
  items,
  variants,
  addons,
  popularIds,
}: {
  token: string
  cafeName: string
  cafeLogo: string | null
  tableLabel: string
  upiEnabled: boolean
  qrPaymentMode: 'pay_later' | 'prepaid' | 'both'
  upsellThreshold: number
  categories: { id: string; name: string }[]
  items: PublicItem[]
  variants: Variant[]
  addons: Addon[]
  popularIds: string[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const [cart, setCart] = useState<Line[]>([])
  const [step, setStep] = useState<'menu' | 'cart' | 'done'>('menu')
  const [phone, setPhone] = useState('')
  const [placing, setPlacing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [placed, setPlaced] = useState<{ code: string; total: number; method: 'upi' | 'counter'; receiptToken: string | null } | null>(null)
  const [upiIntent, setUpiIntent] = useState<{ attempt_id: string; amount: number; upi_uri: string; upi_id: string; payee_name: string; qr_url: string | null } | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [claimStatus, setClaimStatus] = useState<'idle' | 'claiming' | 'claimed'>('idle')
  const [utr, setUtr] = useState('')
  const [isAndroid, setIsAndroid] = useState(false)
  const [assist, setAssist] = useState<'waiter' | 'bill' | null>(null)
  const [assistBusy, setAssistBusy] = useState(false)
  const [detail, setDetail] = useState<PublicItem | null>(null)
  const [reorderNote, setReorderNote] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [activeCat, setActiveCat] = useState<string>('__all')

  const upsellShown = useRef(false)
  const upsellTaken = useRef<string | null>(null)

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const variantsByItem = useMemo(() => {
    const m = new Map<string, Variant[]>()
    variants.forEach((v) => m.set(v.menu_item_id, [...(m.get(v.menu_item_id) ?? []), v]))
    return m
  }, [variants])
  const addonsByItem = useMemo(() => {
    const m = new Map<string, Addon[]>()
    addons.forEach((a) => m.set(a.menu_item_id, [...(m.get(a.menu_item_id) ?? []), a]))
    return m
  }, [addons])

  const hasOptions = useCallback(
    (id: string) => variantsByItem.has(id) || addonsByItem.has(id),
    [variantsByItem, addonsByItem],
  )

  // "New" is only meaningful as a minority signal. When a café first onboards
  // it bulk-imports its whole menu at once, which would otherwise badge every
  // single item as new for two weeks — pure noise. If most of the menu would
  // qualify, nothing is genuinely new, so the badge switches itself off.
  const newItemIds = useMemo(() => {
    const cutoff = Date.now() - NEW_ITEM_DAYS * 86400000
    const fresh = items.filter((i) => new Date(i.created_at).getTime() > cutoff)
    if (items.length === 0 || fresh.length / items.length > 0.3) return new Set<string>()
    return new Set(fresh.map((i) => i.id))
  }, [items])

  // A reorder handed over from "My orders". It arrives as item ids only —
  // prices come from the live menu here and are re-validated again by
  // place_order, so an old order can never lock in an old price.
  useEffect(() => {
    const raw = sessionStorage.getItem(`kp_reorder_${token}`)
    if (!raw) return
    sessionStorage.removeItem(`kp_reorder_${token}`)
    try {
      const payload = JSON.parse(raw) as {
        items: { item_id: string; qty: number; variant_id: string | null; addon_ids: string[]; available: boolean }[]
        unavailable: string[]
      }
      const lines: Line[] = []
      for (const entry of payload.items) {
        const item = items.find((i) => i.id === entry.item_id)
        if (!item || !entry.available) continue
        const variant = entry.variant_id ? variants.find((v) => v.id === entry.variant_id) : null
        const chosen = addons.filter((a) => (entry.addon_ids ?? []).includes(a.id))
        const unitPrice = item.price + (variant?.price_delta ?? 0) + chosen.reduce((s, a) => s + a.price, 0)
        lines.push({
          key: `${item.id}|${variant?.id ?? ''}|${chosen.map((a) => a.id).sort().join(',')}|`,
          itemId: item.id,
          name: item.name,
          variantId: variant?.id ?? null,
          addonIds: chosen.map((a) => a.id),
          modLabel: [variant?.name, ...chosen.map((a) => a.name)].filter(Boolean).join(', '),
          note: '',
          unitPrice,
          qty: entry.qty,
        })
      }
      if (lines.length) setCart(lines)
      const skipped = payload.unavailable ?? []
      setReorderNote(
        lines.length === 0
          ? 'None of those items are available right now.'
          : skipped.length
            ? `Added to your cart. ${skipped.join(', ')} ${skipped.length === 1 ? 'is' : 'are'} unavailable today.`
            : 'Your previous order has been added to the cart.',
      )
    } catch {
      // A corrupt payload should never break the menu — just ignore it.
    }
  }, [token, items, variants, addons])

  const cats = useMemo(() => {
    const withItems = categories.filter((c) => items.some((i) => i.category_id === c.id))
    const uncategorised = items.some((i) => !i.category_id)
    const base = uncategorised ? [...withItems, { id: '__none', name: 'Other' }] : withItems
    return popularIds.length >= 3 ? [{ id: POPULAR, name: 'Popular' }, ...base] : base
  }, [categories, items, popularIds])

  const searching = search.trim().length > 0
  const catNameById = useMemo(() => new Map(categories.map((c) => [c.id, c.name.toLowerCase()])), [categories])

  // Search spans name, description and category name so "coffee" finds the
  // whole section even when no single item is literally called coffee.
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return items.filter((i) => {
      const cat = i.category_id ? (catNameById.get(i.category_id) ?? '') : ''
      return (
        i.name.toLowerCase().includes(q) ||
        (i.description ?? '').toLowerCase().includes(q) ||
        cat.includes(q)
      )
    })
  }, [search, items, catNameById])

  const sections = useMemo(() => {
    if (searching) return []
    const visible = activeCat === '__all' ? cats : cats.filter((c) => c.id === activeCat)
    return visible
      .map((cat) => ({
        cat,
        items:
          cat.id === POPULAR
            ? popularIds.map((id) => byId.get(id)).filter((i): i is PublicItem => Boolean(i))
            : items.filter((i) => (cat.id === '__none' ? !i.category_id : i.category_id === cat.id)),
      }))
      .filter((s) => s.items.length > 0)
  }, [searching, activeCat, cats, items, popularIds, byId])

  const subtotal = cart.reduce((s, l) => s + l.unitPrice * l.qty, 0)
  const count = cart.reduce((s, l) => s + l.qty, 0)

  // Plain (no variant/add-on/note) quantity for a given item, which is what the
  // card's inline stepper controls.
  const plainQty = useCallback((id: string) => cart.find((l) => l.key === `${id}|||`)?.qty ?? 0, [cart])

  const upsell = useMemo(() => {
    if (count === 0 || subtotal < upsellThreshold) return null
    if (cart.some((l) => byId.get(l.itemId)?.is_upsell)) return null
    const cand = items.filter((i) => i.is_upsell && i.available && !hasOptions(i.id))
    return cand.length ? cand.reduce((a, b) => (a.price <= b.price ? a : b)) : null
  }, [count, subtotal, upsellThreshold, cart, items, byId, hasOptions])
  if (upsell && step === 'cart') upsellShown.current = true

  function addLine(line: Line) {
    setCart((c) => {
      const found = c.find((l) => l.key === line.key)
      if (found) return c.map((l) => (l.key === line.key ? { ...l, qty: l.qty + line.qty } : l))
      return [...c, line]
    })
  }
  function changeQty(key: string, delta: number) {
    setCart((c) => c.map((l) => (l.key === key ? { ...l, qty: l.qty + delta } : l)).filter((l) => l.qty > 0))
  }

  function addPlain(item: PublicItem, isUpsell = false) {
    if (isUpsell) upsellTaken.current = item.id
    addLine({
      key: `${item.id}|||`,
      itemId: item.id,
      name: item.name,
      variantId: null,
      addonIds: [],
      modLabel: '',
      note: '',
      unitPrice: item.price,
      qty: 1,
    })
  }

  // Tapping Add on a card: straight in when there's nothing to choose,
  // otherwise open the sheet. Tapping the card itself always opens the sheet.
  function onCardAdd(item: PublicItem) {
    if (hasOptions(item.id)) setDetail(item)
    else addPlain(item)
  }

  function confirmDetail(
    item: PublicItem,
    { variantId, addonIds, note, qty }: { variantId: string | null; addonIds: string[]; note: string; qty: number },
  ) {
    const v = variantId ? variantsByItem.get(item.id)?.find((x) => x.id === variantId) : null
    const chosen = (addonsByItem.get(item.id) ?? []).filter((a) => addonIds.includes(a.id))
    const unit = item.price + (v?.price_delta ?? 0) + chosen.reduce((s, a) => s + a.price, 0)
    const label = [v?.name, ...chosen.map((a) => a.name)].filter(Boolean).join(', ')
    addLine({
      // Note is part of the key so "no onions" and "extra spicy" stay separate
      // lines instead of silently merging into one.
      key: `${item.id}|${variantId ?? ''}|${[...addonIds].sort().join(',')}|${note}`,
      itemId: item.id,
      name: item.name,
      variantId,
      addonIds,
      modLabel: label,
      note,
      unitPrice: unit,
      qty,
    })
    setDetail(null)
  }

  // mode 'now' → pay by UPI immediately; 'later' → pay at the counter. Both
  // place the order first (the server computes the total); the UPI amount is
  // never taken from this browser.
  async function place(mode: 'now' | 'later') {
    if (!PHONE_RE.test(phone)) {
      setError('Enter a valid 10-digit mobile number — we send your bill there.')
      return
    }
    setPlacing(true)
    setError(null)
    // Every QR order is created UNPAID; UPI is collected after placement via
    // the attempt flow, and the payment method the customer actually used is
    // recorded when staff confirm receipt. place_order only accepts
    // counter/cash/card, so the order is always placed as 'counter' here —
    // `mode` drives the on-screen payment step, not the stored method.
    const { data, error } = await supabase.rpc('place_order', {
      p_token: token,
      p_items: cart.map((l) => ({
        item_id: l.itemId,
        qty: l.qty,
        variant_id: l.variantId,
        addon_ids: l.addonIds,
        note: l.note || null,
      })),
      p_phone: phone || null,
      p_payment_method: 'counter',
      p_upsell_item_id: upsellTaken.current,
      p_upsell_shown: upsellShown.current,
    })
    if (error) { setPlacing(false); return setError(error.message) }
    const r = data as { short_code: string; total: number; receipt_token?: string }
    setPlaced({ code: r.short_code, total: r.total, method: mode === 'now' ? 'upi' : 'counter', receiptToken: r.receipt_token ?? null })
    setStep('done')

    if (mode === 'now' && r.receipt_token) {
      // Ask the server to open a UPI attempt with ITS amount. If it can't
      // (config changed), the order is already placed — the customer just
      // pays at the counter instead.
      const { data: intent } = await supabase.rpc('qr_start_upi_payment', { p_receipt_token: r.receipt_token })
      if (intent) setUpiIntent(intent as typeof upiIntent)
    }
    setPlacing(false)
  }

  // Render a QR of the exact-amount UPI intent so desktop / other-phone
  // customers can scan it. Generated client-side; falls back to the café's
  // uploaded static QR if generation fails.
  useEffect(() => {
    if (!upiIntent) { setQrDataUrl(null); return }
    let alive = true
    import('qrcode')
      .then((m) => m.toDataURL(upiIntent.upi_uri, { margin: 1, width: 240 }))
      .then((url) => { if (alive) setQrDataUrl(url) })
      .catch(() => {})
    return () => { alive = false }
  }, [upiIntent])

  // "I have paid" only records a CLAIM. It never marks the order paid — a
  // staff member confirms receipt on their screen.
  async function claimPaid() {
    if (!upiIntent) return
    setClaimStatus('claiming')
    await supabase.rpc('qr_claim_payment', {
      p_attempt_id: upiIntent.attempt_id,
      p_reference: utr.trim() || null,
    })
    setClaimStatus('claimed')
  }

  // Detected after mount (navigator is undefined during SSR).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsAndroid(/android/i.test(navigator.userAgent))
  }, [])

  // A plain upi:// link opens the phone's DEFAULT UPI handler — which may be
  // WhatsApp Pay, not the app the customer tapped. On Android we target the
  // specific app by package via an intent:// URL so "PhonePe" opens PhonePe.
  // Off Android (and for "Any UPI app") we fall back to the generic intent,
  // and the QR always works regardless of app or in-app browser.
  function payHref(pkg?: string): string {
    if (!upiIntent) return '#'
    if (isAndroid && pkg) {
      const query = upiIntent.upi_uri.split('?')[1] ?? ''
      return `intent://pay?${query}#Intent;scheme=upi;package=${pkg};end`
    }
    return upiIntent.upi_uri
  }

  async function callWaiter() {
    setAssistBusy(true)
    const { error } = await supabase.rpc('call_waiter', { p_token: token })
    setAssistBusy(false)
    if (error) return
    setAssist('waiter')
    setTimeout(() => setAssist(null), 4000)
  }

  async function requestBill() {
    setAssistBusy(true)
    const { data, error } = await supabase.rpc('request_bill', { p_token: token })
    setAssistBusy(false)
    if (error) return
    void data
    setAssist('bill')
    setTimeout(() => setAssist(null), 4000)
  }

  // ── Confirmation ─────────────────────────────────────────────────────────
  if (step === 'done' && placed) {
    return (
      <main className="mx-auto flex w-full min-h-dvh max-w-md flex-col items-center justify-center gap-6 p-6 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-full bg-success-subtle text-2xl text-success">✓</div>
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Order placed</h1>
          <p className="mt-1 text-muted-foreground">The kitchen has it. Table {tableLabel}.</p>
        </div>
        <div className="w-full rounded-2xl border border-border bg-surface p-6">
          <p className="text-sm text-muted-foreground">Order number</p>
          <p className="mt-1 text-4xl font-semibold text-foreground">{placed.code}</p>
          <p className="mt-4 border-t border-border pt-4 text-lg text-foreground">₹{placed.total}</p>
        </div>
        {placed.receiptToken && (
          <a
            href={`/r/${placed.receiptToken}`}
            className="w-full rounded-[var(--radius)] border border-border-strong bg-surface py-3.5 text-center font-medium text-foreground"
          >
            View your bill →
          </a>
        )}
        {claimStatus === 'claimed' ? (
          <div className="w-full rounded-2xl border border-warning bg-warning-subtle p-5 text-center">
            <p className="text-[15px] font-medium text-warning">Payment awaiting confirmation</p>
            <p className="mt-1 text-[13px] text-warning">The café will confirm your ₹{upiIntent?.amount ?? placed.total} UPI payment on their screen shortly.</p>
          </div>
        ) : placed.method === 'upi' && upiIntent ? (
          <div className="w-full space-y-3 rounded-2xl border border-border bg-surface p-5">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Pay by UPI</p>
              <p className="mt-0.5 text-3xl font-semibold text-foreground">₹{upiIntent.amount}</p>
            </div>

            {/* Each button opens that specific UPI app (on Android) with the
                café's ID and the exact amount pre-filled. */}
            <div className="space-y-2">
              {[
                { label: 'Google Pay', pkg: 'com.google.android.apps.nbu.paisa.user' },
                { label: 'PhonePe', pkg: 'com.phonepe.app' },
                { label: 'Paytm', pkg: 'net.one97.paytm' },
                { label: 'Any UPI app', pkg: undefined },
              ].map(({ label, pkg }) => (
                <a
                  key={label}
                  href={payHref(pkg)}
                  className={`flex w-full items-center justify-center rounded-[var(--radius)] py-3.5 text-center font-medium ${
                    pkg ? 'bg-primary text-primary-foreground' : 'border border-border-strong bg-surface text-foreground'
                  }`}
                >
                  {label}
                </a>
              ))}
            </div>

            {(qrDataUrl || upiIntent.qr_url) && (
              <div className="flex flex-col items-center gap-2 border-t border-border pt-3">
                <p className="text-[12px] font-medium text-foreground">Opened the wrong app? Scan this instead</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrDataUrl ?? upiIntent.qr_url ?? ''} alt="Scan to pay by UPI" className="h-44 w-44 rounded-[var(--radius)] border border-border bg-white p-2" />
                <p className="text-[11px] text-muted-foreground">Open any UPI app → Scan &amp; Pay → point it here. The amount is already set.</p>
              </div>
            )}

            <div className="border-t border-border pt-3">
              <label className="text-[12px] text-muted-foreground">UPI reference / UTR (optional)</label>
              <input
                value={utr}
                onChange={(e) => setUtr(e.target.value.slice(0, 40))}
                placeholder="12-digit transaction ID"
                className="mt-1 h-11 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground"
              />
            </div>

            <button
              onClick={claimPaid}
              disabled={claimStatus === 'claiming'}
              className="w-full rounded-[var(--radius)] border border-border-strong bg-surface py-3.5 font-medium text-foreground disabled:opacity-50"
            >
              {claimStatus === 'claiming' ? 'Sending…' : 'I have paid'}
            </button>
            <p className="text-center text-[12px] text-muted-foreground">
              Opening a UPI app doesn’t confirm payment on its own — tap “I have paid” once you’ve completed it, and the café will verify.
            </p>
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">Pay ₹{placed.total} at the counter.</p>
        )}
      </main>
    )
  }

  // ── Cart ─────────────────────────────────────────────────────────────────
  if (step === 'cart') {
    return (
      <main className="mx-auto w-full min-h-dvh max-w-md bg-background p-5">
        <button
          onClick={() => setStep('menu')}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground"
        >
          <ArrowLeft size={15} /> Add more items
        </button>

        <ul className="overflow-hidden rounded-2xl border border-border bg-surface">
          {cart.map((l) => (
            <li key={l.key} className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 last:border-0">
              <div className="min-w-0">
                <p className="truncate text-[14px] text-foreground">{l.name}</p>
                {l.modLabel && <p className="truncate text-[12px] text-muted-foreground">{l.modLabel}</p>}
                {l.note && <p className="truncate text-[12px] italic text-muted-foreground">“{l.note}”</p>}
                <p className="text-[13px] text-muted-foreground">₹{l.unitPrice} × {l.qty}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button onClick={() => changeQty(l.key, -1)} aria-label="Remove one" className="grid h-10 w-10 place-items-center text-lg text-muted-foreground">−</button>
                <span className="w-4 text-center text-sm tabular-nums">{l.qty}</span>
                <button onClick={() => changeQty(l.key, 1)} aria-label="Add one" className="grid h-10 w-10 place-items-center text-lg text-muted-foreground">+</button>
                <span className="w-14 text-right text-[14px] font-medium text-foreground">₹{l.unitPrice * l.qty}</span>
              </div>
            </li>
          ))}
        </ul>

        {upsell && (
          <div className="mt-4 flex items-center justify-between gap-4 rounded-2xl border border-primary bg-primary-subtle p-4">
            <div className="min-w-0">
              <p className="font-medium text-primary">{upsell.upsell_pitch ?? `Add ${upsell.name}`}</p>
              <p className="text-sm text-primary">{upsell.name} · ₹{upsell.price}</p>
            </div>
            <button onClick={() => addPlain(upsell, true)} className="shrink-0 rounded-[var(--radius)] bg-primary px-5 py-2 text-sm font-medium text-primary-foreground">Add</button>
          </div>
        )}

        <div className="mt-6">
          <label htmlFor="phone" className="text-sm text-muted-foreground">
            Mobile number <span className="text-muted-foreground">— your bill is sent here</span>
          </label>
          <div className="mt-2 flex items-center rounded-[var(--radius)] border border-border-strong bg-surface">
            <span className="pl-4 pr-2 text-muted-foreground">+91</span>
            <input
              id="phone" type="tel" inputMode="numeric" required value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              placeholder="98765 43210"
              className="h-12 w-full rounded-r-[var(--radius)] bg-transparent pr-4 text-foreground placeholder:text-muted-foreground outline-none"
            />
          </div>
        </div>

        {error && <p className="mt-4 rounded-[var(--radius)] bg-destructive-subtle p-3 text-sm text-destructive">{error}</p>}

        <div className="mt-6 flex items-baseline justify-between border-t border-border pt-4">
          <span className="text-muted-foreground">Total</span>
          <span className="text-2xl font-semibold text-foreground">₹{subtotal}</span>
        </div>

        <div className="mt-4 space-y-3">
          {upiEnabled && (qrPaymentMode === 'prepaid' || qrPaymentMode === 'both') && (
            <button disabled={placing || count === 0} onClick={() => place('now')} className="w-full rounded-[var(--radius)] bg-primary py-4 font-medium text-primary-foreground disabled:opacity-40">
              {placing ? 'Placing…' : `Pay now via UPI · ₹${subtotal}`}
            </button>
          )}
          {qrPaymentMode !== 'prepaid' && (
            <button disabled={placing || count === 0} onClick={() => place('later')} className={`w-full rounded-[var(--radius)] py-4 font-medium disabled:opacity-40 ${upiEnabled && qrPaymentMode === 'both' ? 'border border-border-strong bg-surface text-foreground' : 'bg-foreground text-background'}`}>
              {placing ? 'Placing…' : 'Place order — pay at the counter'}
            </button>
          )}
        </div>
      </main>
    )
  }

  // ── Menu ─────────────────────────────────────────────────────────────────
  return (
    <main className="w-full min-h-dvh bg-background pb-28">
      <OfflineBanner variant="customer" />
      {/* Café identity scrolls away so the sticky strip below stays short —
          on a 640px-tall phone every sticky pixel is menu you can't see. */}
      <div className="mx-auto w-full max-w-6xl px-4 pb-3 pt-4 sm:px-6">
        <div className="flex items-center gap-3">
          {cafeLogo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cafeLogo} alt="" className="h-11 w-11 shrink-0 rounded-xl object-cover" />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[19px] font-semibold leading-tight tracking-tight text-foreground">{cafeName}</h1>
            <p className="text-[13px] text-muted-foreground">Table {tableLabel}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button onClick={callWaiter} disabled={assistBusy} aria-label="Call waiter" title="Call waiter" className="grid h-10 w-10 place-items-center rounded-full border border-border-strong text-foreground disabled:opacity-50">
              <BellRing size={16} />
            </button>
            <button onClick={requestBill} disabled={assistBusy} aria-label="Request bill" title="Request bill" className="grid h-10 w-10 place-items-center rounded-full border border-border-strong text-foreground disabled:opacity-50">
              <ReceiptText size={16} />
            </button>
            <Link href={`/t/${token}/orders`} aria-label="My orders" title="My orders" className="grid h-10 w-10 place-items-center rounded-full border border-border-strong text-foreground">
              <ClipboardList size={16} />
            </Link>
          </div>
        </div>
      </div>

      {/* Sticky: search + categories only. */}
      <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto w-full max-w-6xl px-4 pt-2.5 sm:px-6">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search dishes…"
              aria-label="Search dishes"
              className="h-11 w-full rounded-full border border-border-strong bg-surface pl-10 pr-10 text-[14px] text-foreground placeholder:text-muted-foreground"
            />
            {searching && (
              <button onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground">
                <X size={15} />
              </button>
            )}
          </div>

          {!searching && cats.length > 1 && (
            <div className="-mx-4 mt-2.5 flex gap-2 overflow-x-auto px-4 pb-2.5 sm:-mx-6 sm:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <CatChip label="All" active={activeCat === '__all'} onClick={() => setActiveCat('__all')} />
              {cats.map((c) => (
                <CatChip key={c.id} label={c.name} active={activeCat === c.id} onClick={() => setActiveCat(c.id)} />
              ))}
            </div>
          )}
          {(searching || cats.length <= 1) && <div className="h-2.5" />}
        </div>
      </div>

      {reorderNote && (
        <div className="mx-auto w-full max-w-6xl px-4 pt-3 sm:px-6">
          <p className="rounded-[var(--radius)] bg-primary-subtle px-3 py-2 text-[12.5px] text-primary">{reorderNote}</p>
        </div>
      )}

      {assist && (
        <div className="fixed inset-x-0 top-16 z-30 mx-auto max-w-md px-5">
          <div className="rounded-[var(--radius)] bg-foreground px-4 py-2.5 text-center text-[13px] font-medium text-background shadow-lg">
            {assist === 'waiter' ? "We've notified the staff — someone's on the way." : 'Bill requested — your bill is being prepared.'}
          </div>
        </div>
      )}

      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        {searching ? (
          searchResults.length === 0 ? (
            <div className="py-20 text-center">
              <p className="text-[15px] font-medium text-foreground">No dishes match “{search.trim()}”</p>
              <p className="mt-1 text-[13.5px] text-muted-foreground">Try a different word, or browse the categories.</p>
            </div>
          ) : (
            <section className="pt-5">
              <h2 className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                {searchResults.length} result{searchResults.length === 1 ? '' : 's'}
              </h2>
              <Grid>
                {searchResults.map((item, i) => (
                  <FoodCard
                    key={item.id}
                    item={item}
                    qty={plainQty(item.id)}
                    isNew={newItemIds.has(item.id)}
                    priority={i < 4}
                    onOpen={() => setDetail(item)}
                    onAdd={() => onCardAdd(item)}
                    onDecrement={() => changeQty(`${item.id}|||`, -1)}
                  />
                ))}
              </Grid>
            </section>
          )
        ) : (
          sections.map(({ cat, items: catItems }) => (
            <section key={cat.id} className="pt-6">
              <h2 className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{cat.name}</h2>
              <Grid>
                {catItems.map((item, i) => (
                  <FoodCard
                    key={item.id}
                    item={item}
                    qty={plainQty(item.id)}
                    isNew={newItemIds.has(item.id)}
                    priority={i < 4}
                    onOpen={() => setDetail(item)}
                    onAdd={() => onCardAdd(item)}
                    onDecrement={() => changeQty(`${item.id}|||`, -1)}
                  />
                ))}
              </Grid>
            </section>
          ))
        )}
      </div>

      {/* Sticky cart — appears the moment something is added, so nobody has to
          hunt for a cart icon. */}
      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 sm:px-6">
          <button
            onClick={() => setStep('cart')}
            className="mx-auto flex w-full max-w-md items-center justify-between rounded-full bg-primary px-5 py-3.5 text-primary-foreground shadow-[var(--shadow-lg)] transition-transform active:scale-[0.99]"
          >
            <span className="text-[13.5px] font-medium">
              {count} item{count > 1 ? 's' : ''} · ₹{subtotal}
            </span>
            <span className="text-[14px] font-semibold">View cart →</span>
          </button>
        </div>
      )}

      {detail && (
        <ItemSheet
          item={detail}
          variants={variantsByItem.get(detail.id) ?? []}
          addons={addonsByItem.get(detail.id) ?? []}
          onClose={() => setDetail(null)}
          onAdd={(args) => confirmDetail(detail, args)}
        />
      )}
    </main>
  )
}

function Grid({ children }: { children: React.ReactNode }) {
  // Single column below 380px: at 360px a 2-up grid leaves ~160px per card,
  // which crushes the name, price and Add button together. Everywhere else
  // scales up to 5 columns rather than stretching phone cards across a desktop.
  return (
    <div className="mt-3 grid grid-cols-1 gap-3 min-[380px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {children}
    </div>
  )
}

function CatChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`h-9 shrink-0 whitespace-nowrap rounded-full border px-4 text-[13px] font-medium transition-colors ${
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border-strong bg-surface text-foreground'
      }`}
    >
      {label}
    </button>
  )
}
