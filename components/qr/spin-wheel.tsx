'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Copy, Check, PartyPopper } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { copyText } from '@/lib/desktop-open'
import { type SpinPrize, prizeLabel } from '@/lib/spin-wheel'
import { WheelDial, type DialSegment } from '@/components/spin-wheel-dial'
import { SpinConfetti } from '@/components/spin-confetti'
import { playWinChime, unlockAudio } from '@/lib/spin-fx'

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

type SpinReason = 'spun' | 'unpaid' | 'refunded' | 'cancelled' | 'below_minimum' | 'sold_out'

type WheelState = {
  available: boolean
  title?: string
  subtitle?: string | null
  min_order_amount?: number
  order_total?: number
  enable_confetti?: boolean
  enable_sound?: boolean
  reason?: SpinReason | null
  segments: Segment[]
  result: (SpinPrize & { redeemed: boolean; expired?: boolean }) | null
}

const money = (n: number) => `₹${Math.round(n)}`

/**
 * Why a guest cannot spin right now, in their words rather than the database's.
 *
 * 'spun' is absent on purpose — that guest has a prize, and the prize is the
 * message. The rest each get a sentence that says what happened and, where
 * there is one, what to do about it.
 */
function reasonCopy(state: WheelState): string | null {
  switch (state.reason) {
    case 'unpaid':
      return 'Your spin unlocks the moment this order is marked paid.'
    case 'refunded':
      return 'This order was refunded, so there’s no spin on it.'
    case 'cancelled':
      return 'This order was cancelled, so there’s no spin on it.'
    case 'below_minimum': {
      const min = state.min_order_amount
      const total = state.order_total
      if (min && total !== undefined) {
        // The number is the entire point of a minimum. Saying only "doesn't
        // reach the minimum" wastes the one moment the feature could grow the
        // order it is attached to.
        return `Spend ${money(min)} or more to earn a spin — this order came to ${money(total)}.`
      }
      return 'This order doesn’t reach the minimum to earn a spin — try again on your next order.'
    }
    case 'sold_out':
      return 'Every prize on this wheel has been claimed. Check back on your next visit.'
    default:
      return null
  }
}

// How often to re-ask while the bill is still unpaid.
//
// Most orders are paid at the counter in cash or UPI, and nothing in this
// document ever learns that happened: the wheel fetched its state once on
// mount, and the guest sat on "unlocks when this order is marked paid"
// forever, with a real spin waiting behind a manual page reload nobody thinks
// to do. Ten seconds is slow enough to be invisible on a phone battery and
// fast enough that the wheel appears while the guest is still at the counter.
const UNPAID_POLL_MS = 10_000

// The guest's wheel, shown on the order-confirmation screen and on the bill
// once it's paid. It is only ever a picture: the winning slice is decided by
// spin_the_wheel in the database and this animation lands on whatever came
// back. Nothing here influences the outcome, and the odds are never sent to
// the browser, so there is nothing to read or tamper with.
export function SpinWheel({ receiptToken }: { receiptToken: string }) {
  const supabase = useMemo(() => createClient(), [])
  const [state, setState] = useState<WheelState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [spinning, setSpinning] = useState(false)
  const [turns, setTurns] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [showConfetti, setShowConfetti] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reduceMotion = usePrefersReducedMotion()

  // Guards the poll against overwriting a spin in flight, or the result the
  // guest is currently watching land. A ref rather than the state itself, so
  // the interval below reads the current value without being torn down and
  // rebuilt every time one of them changes.
  const busy = useRef(false)
  useEffect(() => {
    busy.current = spinning || revealed
  }, [spinning, revealed])

  const load = useCallback(
    async (opts: { quiet?: boolean } = {}) => {
      const { data, error: err } = await supabase.rpc('get_spin_wheel', { p_receipt_token: receiptToken })
      if (err) {
        // Previously this branch did not exist: the fetch destructured `data`
        // only, so a 404 (function missing), a 401 (permission revoked), a
        // timeout or an offline phone all left `state` null and rendered
        // nothing at all, indefinitely, with no signal to the guest or the
        // café. A wheel that is switched on must never fail to a blank space.
        if (!opts.quiet) setLoadError(err.message)
        return null
      }
      setLoadError(null)
      return (data as WheelState | null) ?? null
    },
    [supabase, receiptToken],
  )

  useEffect(() => {
    let cancelled = false
    // load() is async and only sets state after its own network round-trip
    // completes — not a synchronous render-phase update.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().then((s) => {
      if (cancelled) return
      setLoading(false)
      if (!s) return
      setState(s)
      // A prize won earlier is shown straight away rather than re-spun.
      if (s.result) setRevealed(true)
    })
    return () => {
      cancelled = true
    }
  }, [load])

  // Re-ask while the bill is unpaid, so paying at the counter reveals the
  // wheel on its own. Quiet: a blip on a café's wifi should not replace a
  // perfectly good "unlocks when paid" message with an error.
  useEffect(() => {
    if (state?.reason !== 'unpaid') return
    let cancelled = false
    const id = window.setInterval(() => {
      if (busy.current) return
      void load({ quiet: true }).then((s) => {
        if (cancelled || !s || busy.current) return
        setState(s)
        if (s.result) setRevealed(true)
      })
    }, UNPAID_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [state?.reason, load])

  const segmentIndexById = useMemo(() => {
    const m = new Map<string, number>()
    ;(state?.segments ?? []).forEach((s, i) => m.set(s.id, i))
    return m
  }, [state])

  async function spin() {
    if (!state || spinning) return
    setSpinning(true)
    setError(null)
    // Must happen inside the click, not at the reveal — see lib/spin-fx.ts.
    if (state.enable_sound !== false) unlockAudio()

    const { data, error: err } = await supabase.rpc('spin_the_wheel', { p_receipt_token: receiptToken })
    if (err || !data) {
      setSpinning(false)
      setError(err?.message ?? 'The wheel could not spin just now.')
      // Almost every failure here means this tab's picture is stale — the
      // usual one is a second tab that already spun, where the raw
      // 'this order has already had its spin' used to sit under a wheel still
      // offering a spin, and the prize actually won was never shown at all.
      void load({ quiet: true }).then((s) => {
        if (!s) return
        setState(s)
        if (s.result) {
          setRevealed(true)
          setError(null)
        }
      })
      return
    }

    const prize = data as SpinPrize
    const slice = state.segments.length || 1
    const landedIdx = segmentIndexById.get(prize.segment_id ?? '')
    // A null segment_id is the server's sold-out fallback, which belongs to no
    // slice. Landing on index 0 (the old behaviour) stopped the pointer on a
    // real prize and then said "better luck next time" underneath it, so an
    // unmatched result stops between slices instead of on top of one.
    const landing = landedIdx === undefined ? 0 : (landedIdx + 0.5) / slice
    setTurns((t) => t + (reduceMotion ? 0 : 6) + (1 - landing))

    const settle = reduceMotion ? 0 : 4200
    window.setTimeout(() => {
      setState((s) => (s ? { ...s, available: false, result: { ...prize, redeemed: false, expired: false } } : s))
      setRevealed(true)
      setSpinning(false)
      if (prize.kind !== 'none') {
        // Both cues now wait for the reveal and both check that something was
        // actually won. The chime used to fire unconditionally 4.2s early.
        if (state.enable_sound !== false) playWinChime()
        if (state.enable_confetti !== false && !reduceMotion) setShowConfetti(true)
      }
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

  // Still asking. Reserving the space matters as much as the words: without
  // it, "loading", "this café has no wheel" and "the request failed" are the
  // same blank rectangle, and the page jumps when the answer arrives.
  if (loading) {
    return (
      <div className="w-full rounded-2xl border border-border bg-surface p-6 text-center" aria-busy="true">
        <div className="mx-auto h-4 w-28 animate-pulse rounded bg-surface-subtle" />
        <div className="mx-auto mt-5 h-[184px] w-[184px] animate-pulse rounded-full bg-surface-subtle" />
      </div>
    )
  }

  // The RPC failed. A café paying for Spin & Win gets a visible symptom
  // instead of an invisible one.
  if (loadError) {
    return (
      <div className="w-full rounded-2xl border border-border bg-surface p-6 text-center">
        <p className="text-[15px] font-semibold text-foreground">Spin &amp; win</p>
        <p className="mt-2 text-[13px] text-muted-foreground">
          We couldn’t load the wheel just now. Refresh the page, or ask staff at the counter.
        </p>
        <button
          onClick={() => {
            setLoading(true)
            void load().then((s) => {
              setLoading(false)
              if (!s) return
              setState(s)
              if (s.result) setRevealed(true)
            })
          }}
          className="mt-3 h-10 rounded-[var(--radius)] border border-border-strong px-4 text-[13px] font-medium text-foreground"
        >
          Try again
        </button>
      </div>
    )
  }

  if (!state) return null
  // A genuine "no wheel here" case (no title in the payload at all) renders
  // nothing. That covers a café not running a wheel and a café whose plan
  // doesn't include one — neither is something to explain to a customer, and
  // the owner is told plainly on their own Spin & Win screen.
  if (state.title === undefined) return null

  const blocked = reasonCopy(state)
  const won = state.result && state.result.kind !== 'none'
  const expired = Boolean(state.result?.expired)
  // The dial stays mounted through the reveal. It used to be torn out in the
  // same commit that ended the 4.2s transition, so the guest never saw the
  // pointer resting on the slice they had just won.
  const showDial = state.available || spinning || revealed || (!state.reason && !state.result)

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-border bg-surface p-6 text-center">
      <p className="text-[15px] font-semibold text-foreground">{state.title ?? 'Spin & win'}</p>
      {state.subtitle && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{state.subtitle}</p>}

      {!revealed && blocked && (
        <p className="mt-4 rounded-[var(--radius)] bg-surface-subtle px-3 py-2.5 text-[13px] text-muted-foreground">
          {blocked}
        </p>
      )}

      {showDial && (
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
            {!revealed && (
              <div className="absolute inset-0 grid place-items-center">
                <button
                  onClick={spin}
                  disabled={spinning || !state.available}
                  className="grid h-14 w-14 place-items-center rounded-full border-4 border-surface bg-primary text-[12px] font-bold uppercase tracking-wide text-primary-foreground shadow-[var(--shadow-lg)] transition-transform active:scale-95 disabled:opacity-60"
                >
                  {spinning ? '···' : 'Spin'}
                </button>
              </div>
            )}
          </div>
          {!revealed && <p className="mt-4 text-[12px] text-muted-foreground">One spin per paid order.</p>}
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
              {/* Expiry is checked, not just displayed. A guest used to be told
                  to bring a lapsed code to the counter and found out in front
                  of staff who cannot override it. */}
              {state.result.redeemed ? (
                <p className="mt-3 text-[12.5px] text-muted-foreground">Already claimed.</p>
              ) : expired ? (
                <p className="mt-3 text-[12.5px] text-destructive">
                  This code expired
                  {state.result.expires_at
                    ? ` on ${new Date(state.result.expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
                    : ''}
                  , so it can no longer be claimed.
                </p>
              ) : (
                <>
                  <p className="mt-3 text-[12.5px] text-muted-foreground">
                    Show this code to staff at the counter on your next visit — they’ll apply it to your bill.
                  </p>
                  {state.result.expires_at && (
                    <p className="mt-1 text-[12px] text-muted-foreground">
                      Use it before {new Date(state.result.expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </p>
                  )}
                </>
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
