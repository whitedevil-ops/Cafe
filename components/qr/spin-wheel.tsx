'use client'

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createClient } from '@/utils/supabase/client'
import { type SpinPrize, prizeLabel } from '@/lib/spin-wheel'

const REDUCE_MOTION = '(prefers-reduced-motion: reduce)'

/**
 * Read as an external store rather than into a ref, because the value is used
 * while rendering — and this way a guest who changes the setting mid-visit
 * gets the new behaviour without a reload. Falls back to "animate" on the
 * server, where there is no media query to ask.
 */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const q = window.matchMedia(REDUCE_MOTION)
      q.addEventListener('change', onChange)
      return () => q.removeEventListener('change', onChange)
    },
    () => window.matchMedia(REDUCE_MOTION).matches,
    () => false,
  )
}

type WheelState = {
  available: boolean
  title?: string
  reason?: 'spun' | 'unpaid' | null
  segments: { id: string; label: string }[]
  result: (SpinPrize & { redeemed: boolean }) | null
}

// The guest's wheel, shown on the order-confirmation screen once the bill is
// paid. It is only ever a picture: the winning slice is decided by
// spin_the_wheel in the database and this animation lands on whatever came
// back. Nothing here influences the outcome, and the odds are never sent to
// the browser, so there is nothing to read or tamper with.
const COLOURS = ['var(--primary)', 'var(--surface-subtle)']

export function SpinWheel({ receiptToken }: { receiptToken: string }) {
  const supabase = useMemo(() => createClient(), [])
  const [state, setState] = useState<WheelState | null>(null)
  const [spinning, setSpinning] = useState(false)
  const [turns, setTurns] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reduceMotion = usePrefersReducedMotion()

  useEffect(() => {
    let cancelled = false
    supabase
      .rpc('get_spin_wheel', { p_receipt_token: receiptToken })
      .then(({ data }) => {
        if (!cancelled && data) {
          const s = data as WheelState
          setState(s)
          // A prize won earlier is shown straight away rather than re-spun.
          if (s.result) setRevealed(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [supabase, receiptToken])

  async function spin() {
    if (!state || spinning) return
    setSpinning(true)
    setError(null)

    const { data, error: err } = await supabase.rpc('spin_the_wheel', { p_receipt_token: receiptToken })
    if (err || !data) {
      setSpinning(false)
      setError(err?.message ?? 'The wheel could not spin just now.')
      return
    }

    const prize = data as SpinPrize
    const idx = state.segments.findIndex((s) => s.id === prize.segment_id)
    const slice = state.segments.length || 1
    // Land the pointer in the middle of the winning slice, after a few whole
    // turns so it reads as a spin rather than a jump.
    const landing = idx >= 0 ? (idx + 0.5) / slice : 0.5
    setTurns((t) => t + (reduceMotion ? 0 : 4) + (1 - landing))

    const settle = reduceMotion ? 0 : 3600
    window.setTimeout(() => {
      setState((s) => (s ? { ...s, available: false, result: { ...prize, redeemed: false } } : s))
      setRevealed(true)
      setSpinning(false)
    }, settle)
  }

  if (!state || (!state.available && !state.result)) return null

  const won = state.result && state.result.kind !== 'none'

  return (
    <div className="w-full rounded-2xl border border-border bg-surface p-6 text-center">
      <p className="text-sm font-medium text-foreground">{state.title ?? 'Spin & win'}</p>

      <div className="relative mx-auto mt-4 h-44 w-44">
        {/* Pointer */}
        <div className="absolute left-1/2 top-0 z-10 h-0 w-0 -translate-x-1/2 border-x-8 border-t-[14px] border-x-transparent border-t-primary" />
        <div
          className="h-44 w-44 rounded-full border-4 border-primary-subtle"
          style={{
            transform: `rotate(${turns * 360}deg)`,
            transition: reduceMotion ? 'none' : 'transform 3.4s cubic-bezier(0.15, 0.8, 0.2, 1)',
            background:
              state.segments.length > 0
                ? `conic-gradient(${state.segments
                    .map((_, i) => {
                      const from = (i / state.segments.length) * 360
                      const to = ((i + 1) / state.segments.length) * 360
                      return `${COLOURS[i % COLOURS.length]} ${from}deg ${to}deg`
                    })
                    .join(', ')})`
                : 'var(--surface-subtle)',
          }}
        />
      </div>

      {revealed && state.result ? (
        <div className="mt-5">
          <p className={`text-lg font-semibold ${won ? 'text-success' : 'text-foreground'}`}>
            {won ? prizeLabel(state.result.kind, state.result.value, state.result.label) : state.result.label}
          </p>
          {won && (
            <>
              <p className="mt-3 text-[12.5px] text-muted-foreground">Show this at the counter</p>
              <p className="mt-1 font-mono text-2xl font-semibold tracking-[0.2em] text-foreground">
                {state.result.code}
              </p>
              {state.result.redeemed && (
                <p className="mt-2 text-[12.5px] text-muted-foreground">Already claimed.</p>
              )}
              {state.result.expires_at && !state.result.redeemed && (
                <p className="mt-2 text-[12px] text-muted-foreground">
                  Use it before {new Date(state.result.expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        <button
          onClick={spin}
          disabled={spinning}
          className="mt-5 w-full rounded-[var(--radius)] bg-primary py-3.5 font-medium text-primary-foreground disabled:opacity-60"
        >
          {spinning ? 'Spinning…' : 'Spin the wheel'}
        </button>
      )}

      {error && <p className="mt-3 text-[13px] text-destructive">{error}</p>}
    </div>
  )
}
