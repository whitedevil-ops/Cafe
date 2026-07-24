'use client'

import { CreditCard, Wallet, Smartphone, Clock3, Tag, PauseCircle, StickyNote, Minus, Plus, X, ArrowRight, Sparkles } from 'lucide-react'
import { StatusBadge } from '@/components/ui/status-badge'

export type CartLine = {
  key: string
  name: string
  modLabel: string
  unitPrice: number
  qty: number
  note?: string
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
  discountType,
  discountValue,
  onDiscountType,
  onDiscountValue,
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
  discountType: 'percent' | 'flat' | null
  discountValue: string
  onDiscountType: (t: 'percent' | 'flat' | null) => void
  onDiscountValue: (v: string) => void
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
  const base = subtotal - discount
  const tax = Math.round((base * taxPercent) / 100)
  const svc = Math.round((base * serviceChargePercent) / 100)
  const total = base + tax + svc
  const itemCount = lines.reduce((s, l) => s + l.qty, 0)
  const overCap = discountType === 'percent' && maxPct !== null && parsedDiscount > maxPct

  const takeaway = orderType === 'takeaway'
  const collecting = takeaway && tender !== 'pending'
  const disabled = placing || overCap || lines.length === 0 || (orderType === 'dine_in' && !tableLabel)

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
    <div className="flex h-full flex-col bg-surface">
      <div className="border-b border-border px-4 py-3.5">
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
            placeholder="Phone (optional)"
            inputMode="numeric"
            className="h-10 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[13px] text-foreground placeholder:text-muted-foreground"
          />
          <input
            value={customerName}
            onChange={(e) => onCustomerName(e.target.value)}
            placeholder="Name (optional)"
            className="h-10 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[13px] text-foreground placeholder:text-muted-foreground"
          />
        </div>
        {lookingUpCustomer && <p className="mt-1.5 text-[11.5px] text-muted-foreground">Looking up customer…</p>}
        {customerLookup?.found && (
          <p className="mt-1.5 rounded-[var(--radius)] bg-primary-subtle px-3 py-1.5 text-[12px] font-medium text-primary">
            {customerLookup.name ?? 'Returning customer'} · {customerLookup.visits} visit{customerLookup.visits === 1 ? '' : 's'} · {customerLookup.points} points
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4">
        {lines.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-muted-foreground">Tap items to add them here.</p>
        ) : (
          <ul className="divide-y divide-border">
            {lines.map((l) => (
              <li key={l.key} className="py-3">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-foreground">{l.name}</p>
                    {l.modLabel && <p className="truncate text-[11.5px] text-muted-foreground">{l.modLabel}</p>}
                    <p className="text-[12px] text-muted-foreground">₹{l.unitPrice}</p>
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
                  <span className="w-14 shrink-0 text-right text-[13.5px] font-semibold text-foreground">₹{l.unitPrice * l.qty}</span>
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

      <div className="border-t border-border p-4">
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
      </div>
    </div>
  )
}
