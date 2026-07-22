'use client'

import { useState } from 'react'
import { X } from 'lucide-react'

const REASONS = ['Customer changed mind', 'Wrong item entered', 'Kitchen out of stock', 'Duplicate order', 'Other']

export function CancelOrderDialog({
  orderLabel,
  submitting,
  error,
  onClose,
  onConfirm,
}: {
  orderLabel: string
  submitting: boolean
  error: string | null
  onClose: () => void
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState(REASONS[0])
  const [note, setNote] = useState('')
  const finalReason = reason === 'Other' ? note.trim() : reason
  const canSubmit = finalReason.length > 0 && !submitting

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-t-2xl bg-surface p-6 shadow-[var(--shadow-lg)] sm:rounded-[var(--radius-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-foreground">Cancel order {orderLabel}?</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">A reason is required — this is recorded in the audit log.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center text-muted-foreground">
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 space-y-1.5">
          {REASONS.map((r) => (
            <label
              key={r}
              className={`flex min-h-11 items-center gap-2 rounded-[var(--radius)] border px-3 text-sm transition-colors ${
                reason === r ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-foreground'
              }`}
            >
              <input type="radio" name="cancel-reason" checked={reason === r} onChange={() => setReason(r)} />
              {r}
            </label>
          ))}
          {reason === 'Other' && (
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Describe the reason…"
              autoFocus
              className="h-11 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground"
            />
          )}
        </div>

        {error && (
          <p className="mt-3 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[12.5px] text-destructive">{error}</p>
        )}

        <div className="mt-5 flex gap-2">
          <button
            onClick={onClose}
            className="min-h-11 flex-1 rounded-[var(--radius)] border border-border-strong text-[14px] font-medium text-foreground"
          >
            Keep order
          </button>
          <button
            onClick={() => onConfirm(finalReason)}
            disabled={!canSubmit}
            className="min-h-11 flex-1 rounded-[var(--radius)] bg-destructive text-[14px] font-medium text-white disabled:opacity-40"
          >
            {submitting ? 'Cancelling…' : 'Cancel order'}
          </button>
        </div>
      </div>
    </div>
  )
}
