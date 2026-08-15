'use client'

import { useState } from 'react'
import { LogIn } from 'lucide-react'

const DURATIONS = [
  { label: '30 minutes', minutes: 30 },
  { label: '1 hour', minutes: 60 },
  { label: '4 hours', minutes: 240 },
]

/**
 * Entry point to an operator café session (migration 0134). Opening someone
 * else's live business is not a thing to do by misclick, so the reason and the
 * duration are asked for up front rather than defaulted silently — and the
 * reason is what lands in platform_audit_logs, which is the record anyone
 * reviewing this later actually reads.
 */
export function OpenCafeDashboard({ cafeId, cafeName }: { cafeId: string; cafeName: string }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [minutes, setMinutes] = useState(60)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    if (!reason.trim()) return setError('Give a reason — it goes in the audit log.')
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/ops/cafe-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cafe_id: cafeId, reason: reason.trim(), minutes }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setBusy(false)
        return setError(body.error ?? 'Could not start the session.')
      }
      // Full navigation, not a router push: the café a request resolves to is
      // decided server-side in getCurrentCafe(), so the new session only takes
      // effect on a fresh request.
      window.location.href = '/dashboard'
    } catch {
      setBusy(false)
      setError('Could not reach the server. Check your connection and try again.')
    }
  }

  return (
    <>
      <button
        onClick={() => { setError(null); setOpen(true) }}
        className="flex min-h-10 items-center gap-1.5 rounded-[var(--radius)] border border-border-strong px-3.5 text-[13px] font-medium text-foreground hover:bg-surface-subtle"
      >
        <LogIn size={14} /> Open dashboard
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-surface p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-lg font-semibold text-foreground">Open {cafeName}</p>
            <p className="mt-2 text-[13px] text-muted-foreground">
              You&apos;ll see this café&apos;s dashboard as their staff do. Anything you change is
              real and affects their live business. The session is logged and ends by itself.
            </p>

            <label className="mt-4 block text-[13px] font-medium text-foreground">
              Reason
              <input
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && start()}
                placeholder="e.g. Owner reports today's sales total looks wrong"
                className="mt-1.5 w-full rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-[13.5px] font-normal text-foreground"
              />
            </label>

            <fieldset className="mt-4">
              <legend className="text-[13px] font-medium text-foreground">Ends after</legend>
              <div className="mt-1.5 flex gap-2">
                {DURATIONS.map((d) => (
                  <button
                    key={d.minutes}
                    onClick={() => setMinutes(d.minutes)}
                    className={`min-h-9 flex-1 rounded-[var(--radius-sm)] border px-2 text-[12.5px] font-medium ${
                      minutes === d.minutes
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border-strong text-foreground hover:bg-surface-subtle'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </fieldset>

            {error && (
              <p className="mt-3 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">
                {error}
              </p>
            )}

            <div className="mt-5 flex gap-2">
              <button
                onClick={() => setOpen(false)}
                disabled={busy}
                className="min-h-10 flex-1 rounded-[var(--radius)] border border-border-strong text-[13px] font-medium text-foreground hover:bg-surface-subtle disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={start}
                disabled={busy}
                className="min-h-10 flex-1 rounded-[var(--radius)] bg-primary text-[13px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {busy ? 'Opening…' : 'Open dashboard'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
