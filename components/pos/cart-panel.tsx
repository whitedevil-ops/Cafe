'use client'

import { useState } from 'react'
import { CreditCard, Wallet, Smartphone, Clock3, Tag, PauseCircle, StickyNote, Minus, Plus, X, ArrowRight, Sparkles, Gift, ShoppingBag } from 'lucide-react'
import { StatusBadge } from '@/components/ui/status-badge'
import { SpinClaim, type HeldPrize } from '@/components/pos/spin-claim'

export type CartLine = {
  key: string
  /** Already carried by every cart line; surfaced here to resolve GST rate. */
  itemId?: string
  name: string
  modLabel: string
  unitPrice: number
  qty: number
  note?: string
  rewardId?: string | null
}
export type PosTable = {
  id: string
  label: string
  occupied: boolean
  capacity: number | null
  area_id: string | null
}
export type PosArea = { id: string; name: string }
export type CustomerLookup = { found: boolean; name?: string; visits?: number; points?: number }

// One vocabulary for how a counter order is settled. A real tender means
// "money received now" → the bill is PAID. 'pending' means the exception:
// the customer walks out unpaid and the bill reads PAYMENT DUE.
export type Tender = 'cash' | 'upi' | 'card' | 'pending'

const PENDING_REASONS = [
  'Customer will pay on pickup',
  'Known customer',
  'Manager approved',
  'Other',
]

export function CartPanel({
  tableLabel,
  tableArea,
  orderType,
  onOrderType,
  dineInEnabled,
  takeawayEnabled,
  bothEnabled,
  onOpenTableSelector,
  onFocusSearch,
  existingSession,
  recommendations,
  onAddRecommendation,
  lines,
  onQty,
  onRemove,
  onNote,
  taxPercent,
  serviceChargePercent,
  tender,
  onTender,
  pendingReason,
  onPendingReason,
  customerPhone,
  onCustomerPhone,
  customerName,
  onCustomerName,
  customerLookup,
  lookingUpCustomer,
  role,
  cafeId,
  gstRegistered,
  taxInclusive,
  itemTaxRates,
  spinEnabled,
  couponsEnabled,
  spinPrize,
  spinDiscount,
  onHoldSpinPrize,
  onClearSpinPrize,
  discountType,
  discountValue,
  onDiscountType,
  onDiscountValue,
  couponCode,
  onCouponCode,
  appliedCoupon,
  couponChecking,
  couponError,
  onApplyCoupon,
  onRemoveCoupon,
  applicableCoupons,
  couponSuggestionsLoading,
  onFocusCouponField,
  onBlurCouponField,
  onPickApplicableCoupon,
  rewards,
  onRedeemReward,
  onPlaceOrder,
  placing,
  error,
  onHold,
  holding,
  heldCount,
  onOpenHeld,
}: {
  tableLabel: string | null
  tableArea: string | null
  orderType: 'dine_in' | 'takeaway'
  onOrderType: (t: 'dine_in' | 'takeaway') => void
  dineInEnabled: boolean
  takeawayEnabled: boolean
  bothEnabled: boolean
  onOpenTableSelector: () => void
  onFocusSearch: () => void
  existingSession: { total: number; itemCount: number; due: number; payState: 'paid' | 'partial' | 'unpaid' | null } | null
  recommendations: { id: string; name: string; price: number; reason: string }[]
  onAddRecommendation: (rec: { id: string; name: string; price: number; reason: string }) => void
  lines: CartLine[]
  onQty: (key: string, delta: number) => void
  onRemove: (key: string) => void
  onNote: (key: string, note: string) => void
  taxPercent: number
  serviceChargePercent: number
  tender: Tender
  onTender: (t: Tender) => void
  pendingReason: string
  onPendingReason: (v: string) => void
  customerPhone: string
  onCustomerPhone: (v: string) => void
  customerName: string
  onCustomerName: (v: string) => void
  customerLookup: CustomerLookup | null
  lookingUpCustomer: boolean
  role: string
  cafeId: string
  /** GST config, mirrored from cafes — see the tax block below. */
  gstRegistered: boolean
  taxInclusive: boolean
  /** menu_item_id -> its own GST rate; null/absent means the café default. */
  itemTaxRates: Record<string, number | null>
  /** Plan entitlement AND the café's own toggle — see pos/page.tsx. */
  spinEnabled: boolean
  couponsEnabled: boolean
  spinPrize: HeldPrize | null
  /** Previewed here, but the server recomputes and is the authority. */
  spinDiscount: number
  onHoldSpinPrize: (prize: HeldPrize) => void
  onClearSpinPrize: () => void
  discountType: 'percent' | 'flat' | null
  discountValue: string
  onDiscountType: (t: 'percent' | 'flat' | null) => void
  onDiscountValue: (v: string) => void
  couponCode: string
  onCouponCode: (v: string) => void
  appliedCoupon: { code: string; discount: number; name: string | null } | null
  couponChecking: boolean
  couponError: string | null
  onApplyCoupon: () => void
  onRemoveCoupon: () => void
  applicableCoupons: { code: string; name: string | null; kind: string; value: number; discount: number }[] | null
  couponSuggestionsLoading: boolean
  onFocusCouponField: () => void
  onBlurCouponField: () => void
  onPickApplicableCoupon: (code: string) => void
  rewards: { id: string; name: string; points_cost: number }[]
  onRedeemReward: (rewardId: string) => void
  onPlaceOrder: () => void
  placing: boolean
  error: string | null
  onHold: () => void
  holding: boolean
  heldCount: number
  onOpenHeld: () => void
}) {
  // Purely a UI reveal state (not lifted to the parent) — the coupon input
  // only renders once "Apply coupon" is tapped, matching the compact
  // "Add item / Apply coupon" button row below the cart lines.
  const [couponOpen, setCouponOpen] = useState(false)
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0)
  const maxPct = role === 'owner' ? null : role === 'manager' ? 15 : 5
  const parsedDiscount = Number(discountValue) || 0
  const discount = discountType === 'percent'
    ? Math.round((subtotal * Math.min(parsedDiscount, maxPct ?? 100)) / 100)
    : discountType === 'flat'
      ? Math.min(Math.round(parsedDiscount), subtotal)
      : 0
  // Mirrors the server's order: staff discount, then the spin prize (which is
  // never measured against the role cap), then the coupon on what's left.
  const spinOff = Math.min(spinDiscount, subtotal - discount)
  const couponDiscount = appliedCoupon ? Math.min(appliedCoupon.discount, subtotal - discount - spinOff) : 0
  const base = subtotal - discount - spinOff - couponDiscount

  // Mirrors apply_order_taxes() branch for branch. It previously did only the
  // third case — tax always added on top at one flat café rate — which was
  // wrong for the two commonest setups: a café that is not GST registered
  // (the DEFAULT, where the server charges zero tax) and one pricing tax
  // inclusive (where the server extracts tax from the price rather than
  // adding it). Both made the cashier read out a total the printed bill did
  // not agree with. Per-item rates are honoured too: a trigger stamps each
  // line with coalesce(menu_items.tax_percent, cafes.tax_percent), so a flat
  // rate here would diverge on any mixed-rate menu.
  //
  // Still a PREVIEW — the server recomputes and remains the authority. With a
  // discount applied the per-line share can round a rupee differently from
  // the server's own allocation; without one this agrees exactly.
  const totalDiscount = discount + spinOff + couponDiscount
  let tax = 0
  if (gstRegistered && subtotal > 0) {
    for (const l of lines) {
      const lineVal = l.unitPrice * l.qty
      const share = Math.round((totalDiscount * lineVal) / subtotal)
      const net = lineVal - share
      const rate = (l.itemId ? itemTaxRates[l.itemId] : null) ?? taxPercent
      tax += taxInclusive
        ? net - Math.round((net * 100) / (100 + rate))
        : Math.round((net * rate) / 100)
    }
  }
  const svc = Math.round((base * serviceChargePercent) / 100)
  // Inclusive tax is already inside the prices, so it is NOT added again.
  const total = gstRegistered && taxInclusive ? base + svc : base + tax + svc
  const itemCount = lines.reduce((s, l) => s + l.qty, 0)
  const overCap = discountType === 'percent' && maxPct !== null && parsedDiscount > maxPct

  const takeaway = orderType === 'takeaway'
  const collecting = takeaway && tender !== 'pending'
  // Customer name + a valid phone are compulsory for every POS order — the
  // café wants every walk-in/counter sale captured for CRM, not just QR
  // self-orders (place_order is unaffected; this is POS-only).
  const phoneValid = /^[6-9]\d{9}$/.test(customerPhone)
  const nameValid = customerName.trim().length > 0
  const disabled = placing || overCap || lines.length === 0 || !phoneValid || !nameValid || (orderType === 'dine_in' && !tableLabel)

  // Primary action text carries the financial intent so staff never have to
  // reason about state: takeaway collects now (or is explicitly left pending);
  // dine-in sends to the kitchen and runs a bill paid later at the table.
  const tenderLabel: Record<'cash' | 'upi' | 'card', string> = { cash: 'Cash', upi: 'UPI', card: 'Card' }
  const placeLabel = placing
    ? 'Placing…'
    : takeaway
      ? collecting
        ? `Collect payment · ${tenderLabel[tender as 'cash' | 'upi' | 'card']} ₹${total}`
        : `Place — payment pending`
      : `Send to kitchen · ₹${total}`

  return (
    // No h-full / internal flex-1-scrolling-middle split here on purpose —
    // that pinned-header/footer-with-a-squeezed-scrolling-middle pattern is
    // what produced the tiny, confusing scroller reported live (the middle
    // region can be squeezed smaller than its own content needs whenever
    // header+footer content is substantial, e.g. customer fields showing,
    // multiple discount rows). This panel just flows top to bottom; whoever
    // places it (the desktop column, the mobile sheet) owns scrolling the
    // whole thing if it doesn't fit.
    <div className="flex flex-col bg-surface">
      {/* Sticky, not the old flex-1-scrolling-middle split — position:sticky
          needs no height math and can't reintroduce the squeeze bug that
          split caused. Stays visible while items/discount/totals scroll
          underneath, so who this order is for and where it's going is
          always on screen. */}
      <div className="sticky top-0 z-10 border-b border-border bg-surface px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {orderType === 'dine_in' ? 'Dine-in' : 'Order'}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="text-[17px] font-semibold text-foreground">
                {orderType === 'dine_in' ? (tableLabel ?? 'Select table') : 'Takeaway'}
              </p>
              {orderType === 'dine_in' && existingSession && existingSession.payState && existingSession.payState !== 'paid' && (
                <StatusBadge status={existingSession.payState === 'partial' ? 'partial' : 'due'}>
                  {existingSession.payState === 'partial' ? 'Partial' : 'Payment Due'}
                </StatusBadge>
              )}
            </div>
            {orderType === 'dine_in' && tableLabel && tableArea && (
              <p className="text-[12px] text-muted-foreground">{tableArea}</p>
            )}
          </div>
          <button
            onClick={onOpenHeld}
            className="relative grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-surface-subtle hover:text-foreground"
            aria-label="Held orders"
          >
            <Clock3 size={18} />
            {heldCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 grid h-4 w-4 place-items-center rounded-full bg-primary text-[9.5px] font-semibold text-primary-foreground">
                {heldCount}
              </span>
            )}
          </button>
        </div>

        {/* Only offer the order types the café has enabled (Settings → Profile).
            When just one is on, the toggle collapses to a static label — the
            server trigger (0051) rejects a disabled type regardless. */}
        {bothEnabled ? (
          <div className="mt-3 flex gap-1 rounded-[var(--radius)] bg-surface-subtle p-1">
            <button
              onClick={() => onOrderType('dine_in')}
              className={`flex-1 rounded-[var(--radius-sm)] py-2 text-[13px] font-medium transition-colors ${
                orderType === 'dine_in' ? 'bg-surface text-foreground shadow-[var(--shadow-sm)]' : 'text-muted-foreground'
              }`}
            >
              Dine-in
            </button>
            <button
              onClick={() => onOrderType('takeaway')}
              className={`flex-1 rounded-[var(--radius-sm)] py-2 text-[13px] font-medium transition-colors ${
                orderType === 'takeaway' ? 'bg-surface text-foreground shadow-[var(--shadow-sm)]' : 'text-muted-foreground'
              }`}
            >
              Takeaway
            </button>
          </div>
        ) : (
          <div className="mt-3 rounded-[var(--radius)] bg-surface-subtle px-3 py-2 text-[13px] font-medium text-foreground">
            {dineInEnabled ? 'Dine-in' : takeawayEnabled ? 'Takeaway' : 'Ordering disabled'}
          </div>
        )}

        {orderType === 'dine_in' && !tableLabel && (
          <button
            onClick={onOpenTableSelector}
            className="mt-2.5 flex h-11 w-full items-center justify-between rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm text-foreground"
          >
            <span className="text-muted-foreground">Choose a table…</span>
            <span className="text-[12px] font-medium text-primary">Select</span>
          </button>
        )}
        {orderType === 'dine_in' && tableLabel && (
          <button onClick={onOpenTableSelector} className="mt-1.5 text-[12.5px] font-medium text-primary hover:underline">
            Change table
          </button>
        )}

        {orderType === 'dine_in' && existingSession && (
          <p className="mt-2 rounded-[var(--radius)] bg-warning-subtle px-3 py-2 text-[12px] text-warning">
            This table has an active order — ₹{existingSession.total} · {existingSession.itemCount} item
            {existingSession.itemCount === 1 ? '' : 's'}. New items join the same table session.
          </p>
        )}

        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <input
            value={customerPhone}
            onChange={(e) => onCustomerPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
            placeholder="Phone number *"
            inputMode="numeric"
            className={`h-10 rounded-[var(--radius)] border bg-surface px-3 text-[13px] text-foreground placeholder:text-muted-foreground ${
              customerPhone && !phoneValid ? 'border-destructive' : 'border-border-strong'
            }`}
          />
          <input
            value={customerName}
            onChange={(e) => onCustomerName(e.target.value)}
            placeholder="Customer name *"
            className="h-10 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[13px] text-foreground placeholder:text-muted-foreground"
          />
        </div>
        {customerPhone && !phoneValid && (
          <p className="mt-1 text-[11.5px] text-destructive">Enter a valid 10-digit mobile number.</p>
        )}
        {lookingUpCustomer && <p className="mt-1.5 text-[11.5px] text-muted-foreground">Looking up customer…</p>}
        {customerLookup?.found && (
          <p className="mt-1.5 rounded-[var(--radius)] bg-primary-subtle px-3 py-1.5 text-[12px] font-medium text-primary">
            {customerLookup.name ?? 'Returning customer'} · {customerLookup.visits} visit{customerLookup.visits === 1 ? '' : 's'} · {customerLookup.points} points
          </p>
        )}
        {customerLookup?.found && rewards.length > 0 && (customerLookup.points ?? 0) > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {rewards
              .filter((r) => r.points_cost <= (customerLookup.points ?? 0))
              .map((r) => (
                <button
                  key={r.id}
                  onClick={() => onRedeemReward(r.id)}
                  className="inline-flex items-center gap-1 rounded-full border border-primary px-2.5 py-1 text-[11.5px] font-medium text-primary hover:bg-primary-subtle"
                >
                  <Gift size={11} /> {r.name} · {r.points_cost}pts
                </button>
              ))}
          </div>
        )}
      </div>

      <div className="px-4">
        {lines.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 py-4 text-center">
            <ShoppingBag size={20} className="text-muted-foreground/40" strokeWidth={1.5} />
            <p className="text-[12.5px] text-muted-foreground">Tap items to add them here.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {lines.map((l) => (
              <li key={l.key} className="py-2.5">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-foreground">{l.name}</p>
                    {l.modLabel && <p className="truncate text-[11.5px] text-muted-foreground">{l.modLabel}</p>}
                    {!l.rewardId && <p className="text-[12px] text-muted-foreground">₹{l.unitPrice}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1 rounded-full border border-border-strong px-1">
                    <button onClick={() => onQty(l.key, -1)} aria-label="Decrease" className="grid h-8 w-8 place-items-center text-muted-foreground">
                      <Minus size={13} />
                    </button>
                    <span className="w-4 text-center text-[13px] font-medium text-foreground">{l.qty}</span>
                    <button onClick={() => onQty(l.key, 1)} aria-label="Increase" className="grid h-8 w-8 place-items-center text-muted-foreground">
                      <Plus size={13} />
                    </button>
                  </div>
                  {l.rewardId ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary bg-primary-subtle px-2 py-0.5 text-[11.5px] font-medium text-primary">
                      <Gift size={11} /> Free
                    </span>
                  ) : (
                    <span className="w-14 shrink-0 text-right text-[13.5px] font-semibold text-foreground">₹{l.unitPrice * l.qty}</span>
                  )}
                  <button onClick={() => onRemove(l.key)} aria-label={`Remove ${l.name}`} className="grid h-8 w-8 shrink-0 place-items-center text-muted-foreground hover:text-destructive">
                    <X size={14} />
                  </button>
                </div>
                <div className="mt-1 flex items-center gap-1.5 pl-0">
                  <StickyNote size={12} className="shrink-0 text-muted-foreground" />
                  <input
                    value={l.note ?? ''}
                    onChange={(e) => onNote(l.key, e.target.value)}
                    placeholder="Note — e.g. no onions"
                    className="h-7 w-full min-w-0 rounded-[var(--radius-sm)] border border-transparent bg-surface-subtle px-2 text-[11.5px] text-foreground placeholder:text-muted-foreground focus:border-border-strong"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex gap-2 px-4 pb-3">
        <button
          type="button"
          onClick={onFocusSearch}
          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius)] border border-border-strong text-[12.5px] font-medium text-foreground hover:bg-surface-subtle"
        >
          <Plus size={13} /> Add item
        </button>
        {couponsEnabled && !appliedCoupon && (
          <button
            type="button"
            onClick={() => setCouponOpen((v) => !v)}
            className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius)] border text-[12.5px] font-medium transition-colors ${
              couponOpen ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-foreground hover:bg-surface-subtle'
            }`}
          >
            <Tag size={13} /> Apply coupon
          </button>
        )}
      </div>

      <div className="border-t border-border p-3.5">
        {/* Smart cross-sell — subtle, one tap to add. Never blocks anything,
            never framed as "AI" to the person using it. */}
        {lines.length > 0 && recommendations.length > 0 && (
          <div className="mb-3 rounded-[var(--radius)] border border-special/25 bg-special-subtle p-2.5">
            <p className="mb-1.5 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-special">
              <Sparkles size={12} /> Goes well together
            </p>
            <div className="flex flex-wrap gap-1.5">
              {recommendations.map((r) => (
                <button key={r.id} onClick={() => onAddRecommendation(r)}
                  className="flex items-center gap-1 rounded-full border border-border-strong bg-surface px-2.5 py-1.5 text-[12px] font-medium text-foreground hover:border-special hover:bg-special-subtle">
                  <Plus size={11} className="text-special" /> {r.name} <span className="text-muted-foreground">₹{r.price}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Hidden rather than disabled on plans without loyalty: a café that
            cannot run a wheel has no codes to redeem, so a greyed-out box
            would only be clutter on the busiest screen in the product. */}
        {spinEnabled && (
          <SpinClaim
            cafeId={cafeId}
            held={spinPrize}
            onHold={onHoldSpinPrize}
            onClear={onClearSpinPrize}
          />
        )}

        <div className="mb-3">
          <div className="flex gap-1.5">
            {(['percent', 'flat'] as const).map((t) => (
              <button
                key={t}
                onClick={() => onDiscountType(discountType === t ? null : t)}
                className={`flex items-center gap-1 rounded-[var(--radius-sm)] border px-2.5 py-1.5 text-[11.5px] font-medium transition-colors ${
                  discountType === t ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-muted-foreground'
                }`}
              >
                <Tag size={12} /> {t === 'percent' ? '% off' : '₹ off'}
              </button>
            ))}
            {discountType && (
              <input
                value={discountValue}
                onChange={(e) => onDiscountValue(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder={discountType === 'percent' ? '%' : '₹'}
                inputMode="decimal"
                className="h-8 w-20 rounded-[var(--radius-sm)] border border-border-strong bg-surface px-2 text-[12.5px] text-foreground"
              />
            )}
            <span className="self-center text-[11px] text-muted-foreground">
              {maxPct === null ? 'No cap (owner)' : `Up to ${maxPct}% (${role})`}
            </span>
          </div>
          {overCap && <p className="mt-1 text-[11.5px] text-destructive">Exceeds your role&apos;s discount limit.</p>}
        </div>

        {/* Same reasoning as the spin box: a café without the coupons
            entitlement has no coupons to apply, so the field can only fail.
            The input itself only renders once "Apply coupon" is tapped (or a
            coupon is already applied, so its chip/remove control stays
            reachable) — the compact button above is the default state. */}
        {couponsEnabled && (couponOpen || appliedCoupon) && (
        <div className="mb-3">
          {appliedCoupon ? (
            <div className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-primary bg-primary-subtle px-2.5 py-1.5">
              <span className="flex items-center gap-1.5 text-[12px] font-medium text-primary">
                <Tag size={12} /> {appliedCoupon.code}{appliedCoupon.name ? ` — ${appliedCoupon.name}` : ''} · −₹{appliedCoupon.discount}
              </span>
              <button onClick={onRemoveCoupon} aria-label="Remove coupon" className="text-primary hover:opacity-70">
                <X size={13} />
              </button>
            </div>
          ) : (
            <div className="relative">
              <div className="flex gap-1.5">
                <input
                  value={couponCode}
                  onChange={(e) => onCouponCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => { if (e.key === 'Enter' && couponCode.trim()) onApplyCoupon() }}
                  onFocus={onFocusCouponField}
                  onBlur={onBlurCouponField}
                  placeholder="Coupon code"
                  className="h-8 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-border-strong bg-surface px-2 text-[12.5px] uppercase text-foreground placeholder:normal-case placeholder:text-muted-foreground"
                />
                <button
                  onClick={onApplyCoupon}
                  disabled={!couponCode.trim() || couponChecking}
                  className="rounded-[var(--radius-sm)] border border-border-strong px-3 text-[11.5px] font-medium text-foreground disabled:opacity-40"
                >
                  {couponChecking ? 'Checking…' : 'Apply'}
                </button>
              </div>
              {!couponCode.trim() && (couponSuggestionsLoading || applicableCoupons !== null) && (
                <div className="absolute inset-x-0 top-[calc(100%+4px)] z-20 overflow-hidden rounded-[var(--radius-sm)] border border-border-strong bg-surface shadow-lg">
                  <p className="border-b border-border px-2.5 py-1.5 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
                    Applicable to this order
                  </p>
                  {couponSuggestionsLoading ? (
                    <p className="px-2.5 py-2.5 text-[12px] text-muted-foreground">Checking…</p>
                  ) : applicableCoupons && applicableCoupons.length > 0 ? (
                    applicableCoupons.map((c) => (
                      <button
                        key={c.code}
                        onMouseDown={(e) => { e.preventDefault(); onPickApplicableCoupon(c.code) }}
                        className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left hover:bg-surface-subtle"
                      >
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-foreground">
                            <Tag size={12} className="shrink-0 text-primary" /> {c.code}
                          </span>
                          {c.name && <span className="block truncate text-[11px] text-muted-foreground">{c.name}</span>}
                        </span>
                        <span className="shrink-0 text-[12.5px] font-medium text-primary">−₹{c.discount}</span>
                      </button>
                    ))
                  ) : (
                    <p className="px-2.5 py-2.5 text-[12px] text-muted-foreground">No coupons available for this order.</p>
                  )}
                </div>
              )}
            </div>
          )}
          {couponError && <p className="mt-1 text-[11.5px] text-destructive">{couponError}</p>}
        </div>
        )}
      </div>

      {/* Sticky total + CTA — same technique as the sticky header above
          (position: sticky within this same naturally-scrolling container),
          NOT the earlier flex-1-constrained-middle layout that produced the
          "tiny, confusing scroller" bug. The item list and everything above
          keep flowing normally with no height constraint, so nothing about
          that failure mode applies here — this just keeps the total and
          Place Order reachable without scrolling through a long cart. */}
      <div className="sticky bottom-0 z-10 border-t border-border bg-surface p-3.5">
        <div className="space-y-1.5 text-[13px]">
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal ({itemCount} item{itemCount === 1 ? '' : 's'})</span>
            <span className="text-foreground">₹{subtotal}</span>
          </div>
          {discount > 0 && (
            <div className="flex justify-between text-primary">
              <span>Discount</span>
              <span>−₹{discount}</span>
            </div>
          )}
          {spinOff > 0 && (
            <div className="flex justify-between text-primary">
              <span>Spin prize ({spinPrize?.code})</span>
              <span>−₹{spinOff}</span>
            </div>
          )}
          {couponDiscount > 0 && (
            <div className="flex justify-between text-primary">
              <span>Coupon ({appliedCoupon?.code})</span>
              <span>−₹{couponDiscount}</span>
            </div>
          )}
          {taxPercent > 0 && (
            <div className="flex justify-between text-muted-foreground">
              <span>Tax ({taxPercent}%)</span>
              <span>₹{tax}</span>
            </div>
          )}
          {serviceChargePercent > 0 && (
            <div className="flex justify-between text-muted-foreground">
              <span>Service charge ({serviceChargePercent}%)</span>
              <span>₹{svc}</span>
            </div>
          )}
          <div className="flex items-baseline justify-between border-t border-border-strong pt-2">
            <span className="text-[13px] font-semibold text-foreground">Total</span>
            <span className="text-[20px] font-bold tracking-tight text-foreground">₹{total}</span>
          </div>
        </div>

        {/* Payment — takeaway is payment-first. Cash/UPI/Card mean money is in
            hand now (bill → PAID). Payment Pending is the explicit exception. */}
        {takeaway ? (
          <div className="mt-3">
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Payment</p>
            <div className="flex gap-2">
              {([
                ['cash', 'Cash', Wallet],
                ['upi', 'UPI', Smartphone],
                ['card', 'Card', CreditCard],
              ] as const).map(([val, label, Icon]) => (
                <button
                  key={val}
                  onClick={() => onTender(val)}
                  className={`flex flex-1 flex-col items-center gap-1 rounded-[var(--radius)] border py-2.5 text-[12px] font-medium transition-colors ${
                    tender === val ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-muted-foreground hover:bg-surface-subtle'
                  }`}
                >
                  <Icon size={17} />
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={() => onTender('pending')}
              className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-[var(--radius)] border py-2 text-[12px] font-medium transition-colors ${
                tender === 'pending' ? 'border-warning bg-warning-subtle text-warning' : 'border-border-strong text-muted-foreground hover:bg-surface-subtle'
              }`}
            >
              <Clock3 size={14} /> Payment pending
            </button>
            {tender === 'pending' && (
              <div className="mt-2 rounded-[var(--radius)] border border-warning-subtle bg-warning-subtle/40 p-2.5">
                <p className="text-[11.5px] font-medium text-warning">Why is this order unpaid?</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {PENDING_REASONS.map((r) => (
                    <button
                      key={r}
                      onClick={() => onPendingReason(r)}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        pendingReason === r ? 'border-warning bg-warning text-white' : 'border-border-strong text-muted-foreground hover:bg-surface'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-3 rounded-[var(--radius)] bg-surface-subtle px-3 py-2 text-[11.5px] text-muted-foreground">
            Dine-in runs an open bill. Collect payment from the <span className="font-medium text-foreground">Tables</span> screen when the guest is ready.
          </p>
        )}

        {error && (
          <p className="mt-3 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[12.5px] text-destructive">{error}</p>
        )}

        <div className="mt-3 flex gap-2">
          <button
            onClick={onHold}
            disabled={holding || lines.length === 0}
            className="flex min-h-12 items-center gap-1.5 rounded-[var(--radius)] border border-border-strong px-4 text-[13px] font-medium text-foreground disabled:opacity-40"
          >
            <PauseCircle size={16} /> Hold
          </button>
          <button
            onClick={onPlaceOrder}
            disabled={disabled}
            className={`flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius)] text-[14.5px] font-semibold transition-colors disabled:opacity-40 ${
              collecting ? 'bg-success text-white hover:opacity-90' : 'bg-primary text-primary-foreground hover:bg-primary-hover'
            }`}
          >
            {placeLabel}
            {!placing && <ArrowRight size={16} />}
          </button>
        </div>
        <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
          {takeaway
            ? collecting ? 'Collects payment and sends to the kitchen' : 'Sends to the kitchen — payment collected later'
            : 'Send order to kitchen & generate bill'}
        </p>
      </div>
    </div>
  )
}
