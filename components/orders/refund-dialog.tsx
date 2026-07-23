'use client'

import { useMemo, useState } from 'react'
import { X, Minus, Plus } from 'lucide-react'

export type RefundableItem = {
  id: string
  name: string
  qty: number
  price: number
  /** Units already refunded on previous refunds — cannot be refunded again. */
  refundedQty?: number
}

const REASONS = ['Wrong item served', 'Quality complaint', 'Order cancelled after payment', 'Overcharged', 'Other']

export function RefundDialog({
  orderLabel,
  orderTotal,
  orderSubtotal,
  alreadyRefunded,
  items,
  defaultMethod,
  submitting,
  error,
  onClose,
  onConfirm,
}: {
  orderLabel: string
  orderTotal: number
  orderSubtotal: number
  alreadyRefunded: number
  items: RefundableItem[]
  defaultMethod: string | null
  submitting: boolean
  error: string | null
  onClose: () => void
  onConfirm: (args: {
    mode: 'full' | 'partial' | 'item'
    amount: number | null
    method: string
    reason: string
    items: { order_item_id: string; qty: number }[]
  }) => void
}) {
  const remaining = Math.max(orderTotal - alreadyRefunded, 0)
  const [mode, setMode] = useState<'full' | 'partial' | 'item'>('full')
  const [amount, setAmount] = useState(String(remaining))
  const [method, setMethod] = useState(defaultMethod || 'cash')
  const [reason, setReason] = useState(REASONS[0])
  const [note, setNote] = useState('')
  const [picked, setPicked] = useState<Record<string, number>>({})

  // Mirrors the server's proportional share so the staff member sees the same
  // number the database will compute. The server remains authoritative — this
  // is a preview, never the value that gets refunded.
  const itemTotal = useMemo(() => {
    return Object.entries(picked).reduce((sum, [id, qty]) => {
      const it = items.find((i) => i.id === id)
      if (!it || qty <= 0) return sum
      const line = it.price * qty
      const share = orderSubtotal > 0 ? Math.round((orderTotal * line) / orderSubtotal) : line
      return sum + share
    }, 0)
  }, [picked, items, orderTotal, orderSubtotal])

  const resolved =
    mode === 'full' ? remaining : mode === 'partial' ? Math.min(Number(amount) || 0, remaining) : Math.min(itemTotal, remaining)

  const finalReason = reason === 'Other' ? note.trim() : reason
  const canSubmit = resolved > 0 && finalReason.length > 0 && !submitting

  function bump(it: RefundableItem, delta: number) {
    const max = it.qty - (it.refundedQty ?? 0)
    setPicked((p) => {
      const next = Math.min(Math.max((p[it.id] ?? 0) + delta, 0), max)
      const copy = { ...p }
      if (next === 0) delete copy[it.id]
      else copy[it.id] = next
      return copy
    })
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose}>
      <div
        className="flex max-h-[92dvh] w-full max-w-md flex-col rounded-t-2xl bg-surface sm:max-h-[88dvh] sm:rounded-[var(--radius-lg)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-foreground">Refund order {orderLabel}</h2>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              ₹{remaining} refundable
              {alreadyRefunded > 0 && ` · ₹${alreadyRefunded} already refunded`}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center text-muted-foreground">
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="flex gap-1 rounded-[var(--radius)] bg-surface-subtle p-1">
            {([
              ['full', 'Full'],
              ['partial', 'Amount'],
              ['item', 'Items'],
            ] as const).map(([m, label]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 rounded-[var(--radius-sm)] py-2 text-[13px] font-medium transition-colors ${
                  mode === m ? 'bg-surface text-foreground shadow-[var(--shadow-sm)]' : 'text-muted-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === 'partial' && (
            <label className="mt-4 block">
              <span className="text-[12px] text-muted-foreground">Refund amount (max ₹{remaining})</span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
                inputMode="numeric"
                className="mt-1 h-11 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[15px] text-foreground"
              />
            </label>
          )}

          {mode === 'item' && (
            <div className="mt-4">
              <p className="text-[12px] text-muted-foreground">
                Each line refunds its share of what was actually charged, so discounts and tax stay correct.
              </p>
              <ul className="mt-2 divide-y divide-border">
                {items.map((it) => {
                  const max = it.qty - (it.refundedQty ?? 0)
                  const n = picked[it.id] ?? 0
                  return (
                    <li key={it.id} className="flex items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13.5px] text-foreground">{it.name}</p>
                        <p className="text-[11.5px] text-muted-foreground">
                          ₹{it.price} × {it.qty}
                          {(it.refundedQty ?? 0) > 0 && ` · ${it.refundedQty} refunded`}
                        </p>
                      </div>
                      {max === 0 ? (
                        <span className="shrink-0 text-[11.5px] text-muted-foreground">Fully refunded</span>
                      ) : (
                        <div className="flex shrink-0 items-center gap-1 rounded-full border border-border-strong px-1">
                          <button onClick={() => bump(it, -1)} disabled={n === 0} aria-label={`Refund one fewer ${it.name}`}
                            className="grid h-8 w-8 place-items-center text-muted-foreground disabled:opacity-30">
                            <Minus size={13} />
                          </button>
                          <span className="w-5 text-center text-[13px] font-medium tabular-nums text-foreground">{n}</span>
                          <button onClick={() => bump(it, 1)} disabled={n >= max} aria-label={`Refund one more ${it.name}`}
                            className="grid h-8 w-8 place-items-center text-muted-foreground disabled:opacity-30">
                            <Plus size={13} />
                          </button>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          <div className="mt-5">
            <span className="text-[12px] text-muted-foreground">Refund method</span>
            <div className="mt-1.5 flex gap-2">
              {['cash', 'card', 'upi'].map((m) => (
                <button
                  key={m}
                  onClick={() => setMethod(m)}
                  className={`min-h-10 flex-1 rounded-[var(--radius)] border text-[13px] font-medium capitalize transition-colors ${
                    method === m ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-muted-foreground'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5">
            <span className="text-[12px] text-muted-foreground">Reason — recorded in the audit log</span>
            <div className="mt-1.5 space-y-1.5">
              {REASONS.map((r) => (
                <label key={r}
                  className={`flex min-h-10 items-center gap-2 rounded-[var(--radius)] border px-3 text-[13.5px] ${
                    reason === r ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-foreground'
                  }`}>
                  <input type="radio" name="refund-reason" checked={reason === r} onChange={() => setReason(r)} />
                  {r}
                </label>
              ))}
              {reason === 'Other' && (
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Describe the reason…"
                  autoFocus
                  className="h-11 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[13.5px] text-foreground placeholder:text-muted-foreground"
                />
              )}
            </div>
          </div>

          {error && (
            <p className="mt-4 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[12.5px] text-destructive">{error}</p>
          )}
        </div>

        <div className="shrink-0 border-t border-border p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <span className="text-[13px] text-muted-foreground">Refunding</span>
            <span className="text-[20px] font-semibold text-foreground">₹{resolved}</span>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="min-h-11 flex-1 rounded-[var(--radius)] border border-border-strong text-[14px] font-medium text-foreground">
              Cancel
            </button>
            <button
              onClick={() =>
                onConfirm({
                  mode,
                  amount: mode === 'partial' ? resolved : null,
                  method,
                  reason: finalReason,
                  items:
                    mode === 'item'
                      ? Object.entries(picked).map(([order_item_id, qty]) => ({ order_item_id, qty }))
                      : [],
                })
              }
              disabled={!canSubmit}
              className="min-h-11 flex-1 rounded-[var(--radius)] bg-destructive text-[14px] font-medium text-white disabled:opacity-40"
            >
              {submitting ? 'Refunding…' : `Refund ₹${resolved}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
