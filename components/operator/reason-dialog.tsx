'use client'

import { useState } from 'react'
import { X } from 'lucide-react'

export function ReasonDialog({
  title,
  description,
  confirmLabel = 'Confirm',
  destructive,
  submitting,
  error,
  onClose,
  onConfirm,
}: {
  title: string
  description?: string
  confirmLabel?: string
  destructive?: boolean
  submitting: boolean
  error: string | null
  onClose: () => void
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose}>
      <div className="w-full max-w-sm rounded-t-2xl bg-surface p-6 shadow-[var(--shadow-lg)] sm:rounded-[var(--radius-lg)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
            {description && <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center text-muted-foreground">
            <X size={16} />
          </button>
        </div>

        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason — required, recorded in the audit log"
          rows={3}
          autoFocus
          className="mt-4 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground"
        />

        {error && <p className="mt-3 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[12.5px] text-destructive">{error}</p>}

        <div className="mt-4 flex gap-2">
          <button onClick={onClose} className="min-h-11 flex-1 rounded-[var(--radius)] border border-border-strong text-[14px] font-medium text-foreground">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(reason.trim())}
            disabled={submitting || reason.trim().length === 0}
            className={`min-h-11 flex-1 rounded-[var(--radius)] text-[14px] font-medium text-white disabled:opacity-40 ${destructive ? 'bg-destructive' : 'bg-primary'}`}
          >
            {submitting ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
