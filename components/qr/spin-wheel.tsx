'use client'

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { copyText } from '@/lib/desktop-open'
import { Copy, Check, PartyPopper } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { type SpinPrize, prizeLabel } from '@/lib/spin-wheel'
import { WheelDial, type DialSegment } from '@/components/spin-wheel-dial'
import { SpinConfetti } from '@/components/spin-confetti'
import { playWinChime } from '@/lib/spin-fx'

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

type Segment = DialSegment & { id: string }

type WheelState = {
  available: boolean
  title?: string
  subtitle?: string | null
  min_order_amount?: number
  enable_confetti?: boolean
  enable_sound?: boolean
  reason?: 'spun' | 'unpaid' | 'below_minimum' | null
  segments: Segment[]
  result: (SpinPrize & { redeemed: boolean }) | null
}

const REASON_COPY: Record<string, string> = {
  unpaid: 'Your spin unlocks the moment this order is marked paid.',
  below_minimum: 'This order doesn’t reach the minimum to earn a spin — try again on your next order.',
}

// The guest's wheel, shown on the order-confirmation screen and on the bill
// once it's paid. It is only ever a picture: the winning slice is decided by
// spin_the_wheel in the database and this animation lands on whatever came
// back. Nothing here influences the outcome, and the odds are never sent to
// the browser, so there is nothing to read or tamper with.
export function SpinWheel({ receiptToken }: { receiptToken: string }) {
  const supabase = useMemo(() => createClient(), [])
  const [state, setState] = useState<WheelState | null>(null)
  const [spinning, setSpinning] = useState(false)
  const [turns, setTurns] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [showConfetti, setShowConfetti] = useState(false)
  const [copied, setCopied] = useState(false)
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

  const segmentIndexById = useMemo(() => {
    const m = new Map<string, number>()
    ;(state?.segments ?? []).forEach((s, i) => m.set(s.id, i))
    return m
  }, [state])

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
    const slice = state.segments.length || 1
    const landedIdx = segmentIndexById.get(prize.segment_id ?? '') ?? 0
    // Land the pointer in the middle of the winning slice, after several
    // whole turns eased to a stop so it reads as a real spin, not a jump.
    const landing = (landedIdx + 0.5) / slice
    setTurns((t) => t + (reduceMotion ? 0 : 6) + (1 - landing))

    if (state.enable_sound !== false) playWinChime()

    const settle = reduceMotion ? 0 : 4200
    window.setTimeout(() => {
      setState((s) => (s ? { ...s, available: false, result: { ...prize, redeemed: false } } : s))
      setRevealed(true)
      setSpinning(false)
      if (prize.kind !== 'none' && state.enable_confetti !== false && !reduceMotion) setShowConfetti(true)
    }, settle)
  }

  async function copyCode() {
    if (!state?.result?.code) return
    // The code stays on screen either way, so a failed copy is a nuisance
    // rather than a loss — but the tick must not lie about having worked.
    if (await copyText(state.result.code)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }
  }

  if (!state) return null
  // A genuine "no wheel here" case (no title in the payload at all) renders
  // nothing, same as before. Anything else — including a blocked reason —
  // is a real wheel the guest should understand, not silence.
  if (state.title === undefined) return null
  if (!state.available && !state.result && !state.reason) return null

  const won = state.result && state.result.kind !== 'none'

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-border bg-surface p-6 text-center">
      <p className="text-[15px] font-semibold text-foreground">{state.title ?? 'Spin & win'}</p>
      {state.subtitle && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{state.subtitle}</p>}

      {!revealed && state.reason && REASON_COPY[state.reason] && (
        <p className="mt-4 rounded-[var(--radius)] bg-surface-subtle px-3 py-2.5 text-[13px] text-muted-foreground">
          {REASON_COPY[state.reason]}
        </p>
      )}

      {(state.available || (!revealed && !state.reason) || spinning) && (
        <>
          <div className="relative mx-auto mt-5 h-[184px] w-[184px]">
            <div className="absolute left-1/2 top-[-6px] z-10 h-0 w-0 -translate-x-1/2 border-x-[9px] border-t-[16px] border-x-transparent border-t-primary drop-shadow-sm" />
            <div
              className="h-full w-full rounded-full shadow-[var(--shadow-lg)]"
              style={{
                transform: `rotate(${turns * 360}deg)`,
                transition: reduceMotion ? 'none' : 'transform 4.2s cubic-bezier(0.13, 0.75, 0.18, 1)',
              }}
            >
              <WheelDial segments={state.segments} size={184} />
            </div>
            <div className="absolute inset-0 grid place-items-center">
              <button
                onClick={spin}
                disabled={spinning}
                className="grid h-14 w-14 place-items-center rounded-full border-4 border-surface bg-primary text-[12px] font-bold uppercase tracking-wide text-primary-foreground shadow-[var(--shadow-lg)] transition-transform active:scale-95 disabled:opacity-90"
              >
                {spinning ? '···' : 'Spin'}
              </button>
            </div>
          </div>
          <p className="mt-4 text-[12px] text-muted-foreground">One spin per paid order.</p>
        </>
      )}

      {revealed && state.result && (
        <div className="mt-5">
          {won ? (
            <>
              <p className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-success">
                <PartyPopper size={16} /> Congratulations!
              </p>
              <p className="mt-1 text-[17px] font-semibold text-foreground">
                You won {prizeLabel(state.result.kind, state.result.value, state.result.label)}
              </p>
              <div className="mt-3 flex items-center justify-center gap-2">
                <div className="rounded-[var(--radius)] border border-dashed border-border-strong bg-surface-subtle px-4 py-2.5">
                  <span className="font-mono text-xl font-semibold tracking-[0.2em] text-foreground">{state.result.code}</span>
                </div>
                <button
                  onClick={copyCode}
                  aria-label="Copy code"
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius)] border border-border-strong text-muted-foreground hover:bg-surface-subtle hover:text-foreground"
                >
                  {copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
                </button>
              </div>
              <p className="mt-3 text-[12.5px] text-muted-foreground">
                {state.result.redeemed
                  ? 'Already claimed.'
                  : 'Show this code to staff at the counter on your next visit to redeem it.'}
              </p>
              {state.result.expires_at && !state.result.redeemed && (
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Use it before {new Date(state.result.expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-[15px] font-medium text-foreground">Better luck next time</p>
              <p className="mt-1 text-[12.5px] text-muted-foreground">Nothing this time — try again on your next visit.</p>
            </>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-[13px] text-destructive">{error}</p>}

      {showConfetti && <SpinConfetti onDone={() => setShowConfetti(false)} />}
    </div>
  )
}
