'use client'

import { useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'

// Server-side enforced too (op_delete_cafe rejects a mismatched name) — this
// is a genuine barrier, not just a UI gesture, since typing the exact name
// is the one thing a stray click or muscle-memory double-click can't fake.
export function DeleteCafeDialog({
  cafeName,
  usage,
  submitting,
  error,
  onClose,
  onConfirm,
}: {
  cafeName: string
  usage: { staff_count: number; orders_count: number; customers_count: number; menu_items_count: number }
  submitting: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => void
}) {
  const [typed, setTyped] = useState('')
  const matches = typed === cafeName

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-t-2xl bg-surface p-6 shadow-[var(--shadow-lg)] sm:rounded-[var(--radius-lg)]"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-destructive-subtle text-destructive">
              <AlertTriangle size={18} />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold text-foreground">Permanently delete {cafeName}?</h2>
              <p className="mt-1 text-[13px] text-muted-foreground">
                This cannot be undone. Every order, payment, GST invoice, customer, and wallet balance tied to this
                café is deleted with it — not archived, gone.
              </p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center text-muted-foreground">
            <X size={16} />
          </button>
        </div>

        <ul className="mt-4 grid grid-cols-2 gap-2 rounded-[var(--radius)] bg-surface-subtle p-3 text-[12.5px] text-muted-foreground">
          <li>{usage.orders_count} orders</li>
          <li>{usage.customers_count} customers</li>
          <li>{usage.staff_count} staff accounts</li>
          <li>{usage.menu_items_count} menu items</li>
        </ul>

        <label className="mt-4 block">
          <span className="text-[12.5px] text-muted-foreground">
            Type <span className="font-semibold text-foreground">{cafeName}</span> to confirm
          </span>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
            className="mt-1.5 h-11 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[16px] text-foreground"
          />
        </label>

        {error && (
          <p className="mt-3 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">{error}</p>
        )}

        <div className="mt-5 flex gap-2">
          <button onClick={onClose} className="min-h-11 flex-1 rounded-[var(--radius)] border border-border-strong text-[14px] font-medium text-foreground">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!matches || submitting}
            className="min-h-11 flex-1 rounded-[var(--radius)] bg-destructive text-[14px] font-medium text-white disabled:opacity-40"
          >
            {submitting ? 'Deleting…' : 'Delete permanently'}
          </button>
        </div>
      </div>
    </div>
  )
}
