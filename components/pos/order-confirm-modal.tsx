'use client'

import { CreditCard, Wallet, Smartphone, Clock3, Tag, X, ArrowRight, Gift, Minus, Plus, StickyNote, Sparkles, ShoppingBag, PauseCircle } from 'lucide-react'
import { StatusBadge } from '@/components/ui/status-badge'
import { SpinClaim, type HeldPrize } from '@/components/pos/spin-claim'
import type { CartLine, Tender, CustomerLookup } from '@/components/pos/cart-panel'

const PENDING_REASONS = [
  'Customer will pay on pickup',
  'Known customer',
  'Manager approved',
  'Other',
]

// The one consolidated popup a cashier works in: table/order-type, the item
// list (still fully editable — qty/notes/remove), customer capture,
// recommendations, discount/coupon/spin, payment, the full total, and the
// actual send/hold. There's no persistent cart panel behind this anymore —
// pos-client.tsx opens this directly from a compact chip in the header
// (desktop) or the existing floating pill (mobile). Every computed value
// (totals, validity) is still owned by cart-panel.tsx (single source of
// truth for the tax/discount preview math) — this component only renders
// them and forwards the same edit callbacks cart-panel.tsx already had.
export function OrderConfirmModal({
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
  existingSession,
  heldCount,
  onOpenHeld,
  lines,
  onQty,
  onRemove,
  onNote,
  onFocusSearch,
  recommendations,
  onAddRecommendation,
  itemCount,
  customerPhone,
  onCustomerPhone,
  customerName,
  onCustomerName,
  customerLookup,
  lookingUpCustomer,
  loyaltyEnabled,
  rewards,
  onRedeemReward,
  phoneValid,
  role,
  cafeId,
  maxPct,
  overCap,
  spinEnabled,
  couponsEnabled,
  spinPrize,
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
  tender,
  onTender,
  pendingReason,
  onPendingReason,
  subtotal,
  discount,
  spinOff,
  couponDiscount,
  tax,
  taxPercent,
  svc,
  serviceChargePercent,
  total,
  error,
  placing,
  canSend,
  onPlaceOrder,
  placeLabel,
  onHold,
  holding,
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
  existingSession: { total: number; itemCount: number; due: number; payState: 'paid' | 'partial' | 'unpaid' | null } | null
  heldCount: number
  onOpenHeld: () => void
  lines: CartLine[]
  onQty: (key: string, delta: number) => void
  onRemove: (key: string) => void
  onNote: (key: string, note: string) => void
  onFocusSearch: () => void
  recommendations: { id: string; name: string; price: number; reason: string }[]
  onAddRecommendation: (rec: { id: string; name: string; price: number; reason: string }) => void
  itemCount: number
  customerPhone: string
  onCustomerPhone: (v: string) => void
  customerName: string
  onCustomerName: (v: string) => void
  customerLookup: CustomerLookup | null
  lookingUpCustomer: boolean
  /** Plan entitlement AND the café's own toggle — see pos/page.tsx. */
  loyaltyEnabled: boolean
  rewards: { id: string; name: string; points_cost: number }[]
  onRedeemReward: (rewardId: string) => void
  phoneValid: boolean
  role: string
  cafeId: string
  maxPct: number | null
  overCap: boolean
  spinEnabled: boolean
  couponsEnabled: boolean
  spinPrize: HeldPrize | null
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
  tender: Tender
  onTender: (t: Tender) => void
  pendingReason: string
  onPendingReason: (v: string) => void
  subtotal: number
  discount: number
  spinOff: number
  couponDiscount: number
  tax: number
  taxPercent: number
  svc: number
  serviceChargePercent: number
  total: number
  error: string | null
  placing: boolean
  canSend: boolean
  onPlaceOrder: () => void
  placeLabel: string
  onHold: () => void
  holding: boolean
}) {
  if (!open) return null

  const takeaway = orderType === 'takeaway'
  const collecting = takeaway && tender !== 'pending'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6">
      <div className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-surface shadow-[var(--shadow-lg)] sm:max-h-[85dvh] sm:w-auto sm:max-w-4xl sm:rounded-[var(--radius-lg)]">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-[16px] font-semibold text-foreground">Review order</h2>
            <p className="text-[12.5px] text-muted-foreground">
              {orderType === 'dine_in' ? (tableLabel ? `${tableLabel}${tableArea ? ` · ${tableArea}` : ''}` : 'No table selected') : 'Takeaway'}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={onOpenHeld}
              className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-surface-subtle hover:text-foreground"
              aria-label="Held orders"
            >
              <Clock3 size={18} />
              {heldCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 grid h-4 w-4 place-items-center rounded-full bg-primary text-[9.5px] font-semibold text-primary-foreground">
                  {heldCount}
                </span>
              )}
            </button>
            <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center text-muted-foreground hover:text-foreground">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Landscape at sm+: item-building on the left, checkout details on
            the right, side by side instead of one long scrolling column —
            there's enough content here (table, items, customer, discount,
            coupon, payment) that a narrow portrait stack meant a lot of
            scrolling to reach the total. Mobile keeps the original single
            stacked column (still a bottom sheet there, sized to match). */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto sm:flex-row sm:overflow-hidden">
        <div className="px-5 py-4 sm:w-[400px] sm:shrink-0 sm:overflow-y-auto sm:border-r sm:border-border">
          {/* Still fully editable here — this is the only cart-line-mutating
              surface now that there's no persistent panel behind this modal. */}
          <div>
            {lines.length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 py-4 text-center">
                <ShoppingBag size={20} className="text-muted-foreground/40" strokeWidth={1.5} />
                <p className="text-[12.5px] text-muted-foreground">No items yet.</p>
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
                    <div className="mt-1 flex items-center gap-1.5">
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

            {/* Closes this popup and hands focus back to the grid's search
                box — adding another item means going back to browsing. */}
            <button
              type="button"
              onClick={onFocusSearch}
              className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-[var(--radius)] border border-border-strong text-[12.5px] font-medium text-foreground hover:bg-surface-subtle"
            >
              <Plus size={13} /> Add item
            </button>

            {lines.length > 0 && recommendations.length > 0 && (
              <div className="mt-3 rounded-[var(--radius)] border border-special/25 bg-special-subtle p-2.5">
                <p className="mb-1.5 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-special">
                  <Sparkles size={12} /> Goes well together
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {recommendations.map((r) => (
                    <button key={r.id} onClick={() => onAddRecommendation(r)}
                      className="flex items-center gap-1.5 rounded-[var(--radius)] border border-border-strong bg-surface px-2.5 py-1.5 text-left hover:border-special hover:bg-special-subtle">
                      <Plus size={11} className="shrink-0 text-special" />
                      <span className="min-w-0">
                        <span className="block truncate text-[12px] font-medium text-foreground">{r.name}</span>
                        <span className="block text-[10.5px] text-muted-foreground">{r.reason} · ₹{r.price}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-4 sm:min-w-0 sm:flex-1 sm:overflow-y-auto">
          {/* Only offer the order types the café has enabled (Settings → Profile).
              When just one is on, the toggle collapses to a static label — the
              server trigger (0051) rejects a disabled type regardless. */}
          {bothEnabled ? (
            <div className="flex gap-1 rounded-[var(--radius)] bg-surface-subtle p-1">
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
            <div className="rounded-[var(--radius)] bg-surface-subtle px-3 py-2 text-[13px] font-medium text-foreground">
              {dineInEnabled ? 'Dine-in' : takeawayEnabled ? 'Takeaway' : 'Ordering disabled'}
            </div>
          )}

          {orderType === 'dine_in' && (
            <div className="mt-2.5 flex items-center justify-between">
              {tableLabel ? (
                <span className="flex items-center gap-1.5 text-[13px] text-foreground">
                  {tableLabel}
                  {existingSession && existingSession.payState && existingSession.payState !== 'paid' && (
                    <StatusBadge status={existingSession.payState === 'partial' ? 'partial' : 'due'}>
                      {existingSession.payState === 'partial' ? 'Partial' : 'Payment Due'}
                    </StatusBadge>
                  )}
                </span>
              ) : (
                <span className="text-[13px] text-muted-foreground">No table selected</span>
              )}
              <button onClick={onOpenTableSelector} className="text-[12.5px] font-medium text-primary hover:underline">
                {tableLabel ? 'Change table' : 'Choose a table…'}
              </button>
            </div>
          )}

          {orderType === 'dine_in' && existingSession && (
            <p className="mt-2 rounded-[var(--radius)] bg-warning-subtle px-3 py-2 text-[12px] text-warning">
              This table has an active order — ₹{existingSession.total} · {existingSession.itemCount} item
              {existingSession.itemCount === 1 ? '' : 's'}. New items join the same table session.
            </p>
          )}

          <div className="mt-4 grid grid-cols-2 gap-2">
            <input
              value={customerPhone}
              onChange={(e) => onCustomerPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              placeholder="Phone number (optional)"
              inputMode="numeric"
              className={`h-10 rounded-[var(--radius)] border bg-surface px-3 text-[13px] text-foreground placeholder:text-muted-foreground ${
                customerPhone && !phoneValid ? 'border-destructive' : 'border-border-strong'
              }`}
            />
            <input
              value={customerName}
              onChange={(e) => onCustomerName(e.target.value)}
              placeholder="Customer name (optional)"
              className="h-10 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[13px] text-foreground placeholder:text-muted-foreground"
            />
          </div>
          {customerPhone && !phoneValid && (
            <p className="mt-1 text-[11.5px] text-destructive">Enter a valid 10-digit mobile number.</p>
          )}
          {lookingUpCustomer && <p className="mt-1.5 text-[11.5px] text-muted-foreground">Looking up customer…</p>}
          {customerLookup?.found && (
            <p className="mt-1.5 rounded-[var(--radius)] bg-primary-subtle px-3 py-1.5 text-[12px] font-medium text-primary">
              {customerLookup.name ?? 'Returning customer'} · {customerLookup.visits} visit{customerLookup.visits === 1 ? '' : 's'}
              {/* Points exist as data regardless of plan — a downgraded café
                  still has the balance on file, it just can't earn/redeem
                  right now. Showing "0 points" or a real number either way
                  invites a redemption the server will reject; leaving the
                  line off matches what the café can actually do today. */}
              {loyaltyEnabled && <> · {customerLookup.points} points</>}
            </p>
          )}
          {loyaltyEnabled && customerLookup?.found && rewards.length > 0 && (customerLookup.points ?? 0) > 0 && (
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

          {spinEnabled && (
            <div className="mt-3.5">
              <SpinClaim cafeId={cafeId} held={spinPrize} onHold={onHoldSpinPrize} onClear={onClearSpinPrize} />
            </div>
          )}

          <div className="mt-3.5">
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

          {couponsEnabled && (
            <div className="mt-3.5">
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

          {takeaway && (
            <div className="mt-3.5">
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
          )}
          {!takeaway && (
            <p className="mt-3.5 rounded-[var(--radius)] bg-surface-subtle px-3 py-2 text-[11.5px] text-muted-foreground">
              Dine-in runs an open bill. Collect payment from the <span className="font-medium text-foreground">Tables</span> screen when the guest is ready.
            </p>
          )}
        </div>
        </div>

        {/* Sticky within the modal's own scroll container — same technique
            used for cart-panel.tsx's totals footer, for the same reason. */}
        <div className="shrink-0 border-t border-border p-4">
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
                <span>Spin prize</span>
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
              disabled={!canSend}
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
    </div>
  )
}
