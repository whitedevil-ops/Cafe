'use client'

import type { HeldPrize } from '@/components/pos/spin-claim'
import { OrderConfirmModal } from '@/components/pos/order-confirm-modal'

export type CartLine = {
  key: string
  /** Already carried by every cart line; surfaced here to resolve GST rate. */
  itemId?: string
  name: string
  modLabel: string
  unitPrice: number
  /** Set only when a Today's Offer discount is actually active for this line
   *  (i.e. it differs from unitPrice) — purely for the struck-through display,
   *  same variant/add-on deltas already folded in as unitPrice. Never used in
   *  any total/tax calculation; unitPrice alone remains what's charged. */
  originalUnitPrice?: number
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

// No visible trigger of its own anymore — pos-client.tsx owns exactly where
// "open the order" lives (a compact chip in the header on desktop, the
// existing floating pill on mobile) and controls `open`/`onClose` directly,
// so both entry points drive the same modal instance. This component is now
// purely the tax/discount preview math (single source of truth, unchanged)
// plus the OrderConfirmModal it feeds.
export function CartPanel({
  open,
  onClose,
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
  willAppend,
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
  loyaltyEnabled,
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
  open: boolean
  onClose: () => void
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
  /** Whether this submission will join that existing bill (append_order_items,
   *  migration 0218) instead of starting a new order — resolved in pos-client.tsx. */
  willAppend: boolean
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
  loyaltyEnabled: boolean
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
  // Customer name/phone are optional — a cashier can send an order with
  // neither filled in (staff_place_order already treats both as nullable and
  // simply skips the customer-CRM upsert when phone is empty). Still
  // validated when something IS entered, so a half-typed or malformed phone
  // number can't silently reach the RPC as garbage.
  const phoneValid = customerPhone.trim().length === 0 || /^[6-9]\d{9}$/.test(customerPhone)
  const nameValid = true
  /**
   * An item prize held against a bill that does not contain the item.
   *
   * staff_place_order raises on exactly this, and because the check runs inside
   * the order transaction it rolls back the WHOLE order rather than just
   * dropping the discount. So it surfaced as a generic order-placement failure,
   * in the order-error slot, AFTER the staffer had read out the total and taken
   * the customer's money out. Everything needed to catch it first is already
   * here: spinDiscount is 0 for precisely this case.
   */
  const spinPrizeItemMissing = Boolean(spinPrize && spinPrize.kind === 'item' && spinDiscount === 0)
  const canSend = lines.length > 0 && !(orderType === 'dine_in' && !tableLabel)
    && !placing && !overCap && phoneValid && nameValid && !spinPrizeItemMissing

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
      : willAppend
        ? `Add to bill · ₹${total}`
        : `Send to kitchen · ₹${total}`

  return (
    <OrderConfirmModal
      open={open}
      onClose={onClose}
      tableLabel={tableLabel}
      tableArea={tableArea}
      orderType={orderType}
      onOrderType={onOrderType}
      dineInEnabled={dineInEnabled}
      takeawayEnabled={takeawayEnabled}
      bothEnabled={bothEnabled}
      onOpenTableSelector={onOpenTableSelector}
      existingSession={existingSession}
      willAppend={willAppend}
      heldCount={heldCount}
      onOpenHeld={onOpenHeld}
      lines={lines}
      onQty={onQty}
      onRemove={onRemove}
      onNote={onNote}
      onFocusSearch={onFocusSearch}
      recommendations={recommendations}
      onAddRecommendation={onAddRecommendation}
      itemCount={itemCount}
      customerPhone={customerPhone}
      onCustomerPhone={onCustomerPhone}
      customerName={customerName}
      onCustomerName={onCustomerName}
      customerLookup={customerLookup}
      lookingUpCustomer={lookingUpCustomer}
      rewards={rewards}
      onRedeemReward={onRedeemReward}
      phoneValid={phoneValid}
      role={role}
      cafeId={cafeId}
      maxPct={maxPct}
      overCap={overCap}
      loyaltyEnabled={loyaltyEnabled}
      spinEnabled={spinEnabled}
      couponsEnabled={couponsEnabled}
      spinPrize={spinPrize}
      spinPrizeItemMissing={spinPrizeItemMissing}
      onHoldSpinPrize={onHoldSpinPrize}
      onClearSpinPrize={onClearSpinPrize}
      discountType={discountType}
      discountValue={discountValue}
      onDiscountType={onDiscountType}
      onDiscountValue={onDiscountValue}
      couponCode={couponCode}
      onCouponCode={onCouponCode}
      appliedCoupon={appliedCoupon}
      couponChecking={couponChecking}
      couponError={couponError}
      onApplyCoupon={onApplyCoupon}
      onRemoveCoupon={onRemoveCoupon}
      applicableCoupons={applicableCoupons}
      couponSuggestionsLoading={couponSuggestionsLoading}
      onFocusCouponField={onFocusCouponField}
      onBlurCouponField={onBlurCouponField}
      onPickApplicableCoupon={onPickApplicableCoupon}
      tender={tender}
      onTender={onTender}
      pendingReason={pendingReason}
      onPendingReason={onPendingReason}
      subtotal={subtotal}
      discount={discount}
      spinOff={spinOff}
      couponDiscount={couponDiscount}
      tax={tax}
      taxPercent={taxPercent}
      svc={svc}
      serviceChargePercent={serviceChargePercent}
      total={total}
      error={error}
      placing={placing}
      canSend={canSend}
      onPlaceOrder={onPlaceOrder}
      placeLabel={placeLabel}
      onHold={onHold}
      holding={holding}
    />
  )
}
