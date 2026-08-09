'use client'

import { useMemo, useState } from 'react'
import { Gift, X } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { type SpinPrizeKind, prizeLabel } from '@/lib/spin-wheel'

export type HeldPrize = {
  code: string
  label: string
  kind: SpinPrizeKind
  value: number
  menu_item_id: string | null
  variant_id: string | null
}

type Found = HeldPrize & { id: string; redeemed: boolean; expired: boolean }

/**
 * The counter half of the spin wheel: a guest reads out the code on their
 * phone, staff check it, and it rides along with the bill.
 *
 * Checking a code does not spend it. The prize is redeemed inside
 * staff_place_order, in the same transaction as the order — so an abandoned
 * bill costs the guest nothing, the claim is recorded against the order it
 * paid for, and two tills racing one code means the second order raises and
 * rolls back rather than quietly honouring it twice. What is shown here is
 * therefore a preview; the server checks again for real.
 */
export function SpinClaim({
  cafeId,
  held,
  onHold,
  onClear,
}: {
  cafeId: string
  /** The prize currently riding with this bill, if staff have attached one. */
  held: HeldPrize | null
  onHold: (prize: HeldPrize) => void
  onClear: () => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const [code, setCode] = useState('')
  const [found, setFound] = useState<Found | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function look() {
    const c = code.trim()
    if (!c) return
    setBusy(true)
    setError(null)
    setFound(null)
    const { data, error: err } = await supabase.rpc('find_spin_prize', { p_cafe_id: cafeId, p_code: c })
    setBusy(false)
    if (err) return setError(err.message)
    setFound(data as Found)
  }

  function attach() {
    if (!found) return
    onHold({
      code: code.trim().toUpperCase(),
      label: found.label,
      kind: found.kind,
      value: found.value,
      menu_item_id: found.menu_item_id,
      variant_id: found.variant_id,
    })
    setCode('')
    setFound(null)
  }

  const usable = found && !found.redeemed && !found.expired && found.kind !== 'none'

  if (held) {
    return (
      <div className="mb-3 flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-primary bg-primary-subtle px-2.5 py-1.5">
        <span className="flex min-w-0 items-center gap-1.5 text-[12px] font-medium text-primary">
          <Gift size={12} className="shrink-0" />
          <span className="truncate">
            {held.code} — {prizeLabel(held.kind, held.value, held.label)}
          </span>
        </span>
        <button onClick={onClear} aria-label="Remove spin prize" className="shrink-0 text-primary hover:opacity-70">
          <X size={13} />
        </button>
      </div>
    )
  }

  return (
    <div className="mb-3">
      <div className="flex gap-1.5">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void look()
            }
          }}
          placeholder="Spin code"
          aria-label="Spin prize code"
          className="h-8 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-border-strong bg-surface px-2 font-mono text-[12.5px] uppercase tracking-widest text-foreground"
        />
        <button
          onClick={look}
          disabled={busy || !code.trim()}
          className="h-8 shrink-0 rounded-[var(--radius-sm)] border border-border-strong px-2.5 text-[12px] font-medium text-muted-foreground disabled:opacity-50"
        >
          Check
        </button>
      </div>

      {found && (
        <div className="mt-1.5 rounded-[var(--radius-sm)] bg-surface-subtle px-2.5 py-1.5">
          <p className="text-[12px] font-medium text-foreground">
            {prizeLabel(found.kind, found.value, found.label)}
          </p>
          {found.redeemed && <p className="text-[11.5px] text-muted-foreground">Already claimed.</p>}
          {found.expired && !found.redeemed && <p className="text-[11.5px] text-muted-foreground">This one has expired.</p>}
          {found.kind === 'none' && <p className="text-[11.5px] text-muted-foreground">That spin didn&apos;t win anything.</p>}
          {usable && (
            <>
              {found.kind === 'item' && (
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                  Add the item to the bill — it comes off the total when the order is placed.
                </p>
              )}
              <button
                onClick={attach}
                className="mt-1.5 h-8 w-full rounded-[var(--radius-sm)] bg-primary text-[12px] font-medium text-primary-foreground"
              >
                Add to this bill
              </button>
            </>
          )}
        </div>
      )}

      {error && <p className="mt-1.5 text-[11.5px] text-destructive">{error}</p>}
    </div>
  )
}
