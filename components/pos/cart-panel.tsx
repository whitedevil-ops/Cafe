'use client'

import { Minus, Plus, X, Banknote, CreditCard, Wallet } from 'lucide-react'

export type CartLine = {
  key: string
  name: string
  modLabel: string
  unitPrice: number
  qty: number
}
export type PosTable = { id: string; label: string; occupied: boolean }

export function CartPanel({
  tableLabel,
  orderType,
  onOrderType,
  tables,
  selectedTableId,
  onSelectTable,
  lines,
  onQty,
  onRemove,
  taxPercent,
  serviceChargePercent,
  paymentMethod,
  onPaymentMethod,
  onPlaceOrder,
  placing,
  error,
}: {
  tableLabel: string | null
  orderType: 'dine_in' | 'takeaway'
  onOrderType: (t: 'dine_in' | 'takeaway') => void
  tables: PosTable[]
  selectedTableId: string | null
  onSelectTable: (id: string) => void
  lines: CartLine[]
  onQty: (key: string, delta: number) => void
  onRemove: (key: string) => void
  taxPercent: number
  serviceChargePercent: number
  paymentMethod: 'cash' | 'card' | 'counter'
  onPaymentMethod: (m: 'cash' | 'card' | 'counter') => void
  onPlaceOrder: () => void
  placing: boolean
  error: string | null
}) {
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0)
  const tax = Math.round((subtotal * taxPercent) / 100)
  const svc = Math.round((subtotal * serviceChargePercent) / 100)
  const total = subtotal + tax + svc
  const itemCount = lines.reduce((s, l) => s + l.qty, 0)

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="border-b border-border px-4 py-3.5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {orderType === 'dine_in' ? 'Table' : 'Order'}
            </p>
            <p className="text-[17px] font-semibold text-foreground">
              {orderType === 'dine_in' ? (tableLabel ?? 'Select table') : 'Takeaway'}
            </p>
          </div>
        </div>

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

        {orderType === 'dine_in' && (
          <select
            value={selectedTableId ?? ''}
            onChange={(e) => onSelectTable(e.target.value)}
            className="mt-2.5 h-11 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm text-foreground"
          >
            <option value="" disabled>Choose a table…</option>
            {tables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}{t.occupied ? ' · occupied' : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4">
        {lines.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-muted-foreground">Tap items to add them here.</p>
        ) : (
          <ul className="divide-y divide-border">
            {lines.map((l) => (
              <li key={l.key} className="flex items-center gap-2 py-3">
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
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-border p-4">
        <div className="space-y-1.5 text-[13px]">
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal ({itemCount} item{itemCount === 1 ? '' : 's'})</span>
            <span className="text-foreground">₹{subtotal}</span>
          </div>
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
          <div className="flex justify-between border-t border-border-strong pt-2 text-[16px] font-semibold text-foreground">
            <span>Total</span>
            <span>₹{total}</span>
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          {([
            ['cash', 'Cash', Wallet],
            ['card', 'Card', CreditCard],
            ['counter', 'Pay later', Banknote],
          ] as const).map(([val, label, Icon]) => (
            <button
              key={val}
              onClick={() => onPaymentMethod(val)}
              className={`flex flex-1 flex-col items-center gap-1 rounded-[var(--radius)] border py-2 text-[11.5px] font-medium transition-colors ${
                paymentMethod === val ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-muted-foreground'
              }`}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>

        {error && (
          <p className="mt-3 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[12.5px] text-destructive">{error}</p>
        )}

        <button
          onClick={onPlaceOrder}
          disabled={placing || lines.length === 0 || (orderType === 'dine_in' && !selectedTableId)}
          className="mt-3 min-h-12 w-full rounded-[var(--radius)] bg-primary text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-40"
        >
          {placing ? 'Placing order…' : `Place order · ₹${total}`}
        </button>
      </div>
    </div>
  )
}
