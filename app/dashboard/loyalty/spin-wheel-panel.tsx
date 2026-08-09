'use client'

import { useMemo, useState } from 'react'
import { Trash2, Percent } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import {
  type SpinSegment,
  type SpinWheel,
  type SpinPrizeKind,
  totalWeight,
  oneInPhrase,
  percentPhrase,
  weightsForOneIn,
} from '@/lib/spin-wheel'

type MenuItemLite = { id: string; name: string; price: number; archived: boolean }

const SELECT_CLS =
  'h-9 w-full min-w-0 rounded-[var(--radius)] border border-border-strong bg-surface px-2 text-[13px] text-foreground'

const KINDS: { value: SpinPrizeKind; label: string }[] = [
  { value: 'item', label: 'Free item' },
  { value: 'percent', label: '% off' },
  { value: 'flat', label: '₹ off' },
  { value: 'none', label: 'No prize' },
]

const emptySegment: SpinSegment = { label: '', kind: 'none', menu_item_id: null, variant_id: null, value: 0, weight: 1 }

// A wheel that only ever pays out is a wheel that bankrupts the café, so a new
// one starts with losing slices already outnumbering the prize.
const STARTER: SpinSegment[] = [
  { label: 'Better luck next time', kind: 'none', menu_item_id: null, variant_id: null, value: 0, weight: 10 },
  { label: '10% off next visit', kind: 'percent', menu_item_id: null, variant_id: null, value: 10, weight: 6 },
  { label: '₹50 off next visit', kind: 'flat', menu_item_id: null, variant_id: null, value: 50, weight: 3 },
  { label: 'Free item', kind: 'item', menu_item_id: null, variant_id: null, value: 0, weight: 1 },
]

export default function SpinWheelPanel({
  cafeId,
  canManage,
  items,
  initialWheel,
  initialSegments,
}: {
  cafeId: string
  canManage: boolean
  items: MenuItemLite[]
  initialWheel: SpinWheel | null
  initialSegments: SpinSegment[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const { toast } = useToast()

  const [title, setTitle] = useState(initialWheel?.title ?? 'Spin & win')
  const [active, setActive] = useState(initialWheel?.active ?? false)
  const [expiryDays, setExpiryDays] = useState(initialWheel?.expiry_days == null ? '' : String(initialWheel.expiry_days))
  const [segments, setSegments] = useState<SpinSegment[]>(
    initialSegments.length > 0 ? initialSegments : STARTER,
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const liveItems = useMemo(() => items.filter((i) => !i.archived), [items])
  const total = totalWeight(segments)

  function patch(idx: number, next: Partial<SpinSegment>) {
    setSegments((list) => list.map((s, i) => (i === idx ? { ...s, ...next } : s)))
  }

  /** "Make this 1 in N" — the odds an owner names, applied to the whole wheel. */
  function setOdds(idx: number, oneIn: number) {
    const weights = weightsForOneIn(segments, idx, oneIn)
    if (!weights) {
      setError('That can\'t be done with the slices you have — give the other slices a chance above zero first.')
      return
    }
    setError(null)
    setSegments((list) => list.map((s, i) => ({ ...s, weight: weights[i] })))
  }

  async function save() {
    if (segments.length === 0) return setError('Add at least one slice.')
    for (const s of segments) {
      if (!s.label.trim()) return setError('Every slice needs a label.')
      if (s.kind === 'item' && !s.menu_item_id) return setError(`Pick the item for "${s.label}".`)
      if (s.kind === 'percent' && (s.value < 1 || s.value > 100)) return setError(`"${s.label}" — a discount is between 1 and 100%.`)
      if (s.kind === 'flat' && s.value <= 0) return setError(`"${s.label}" — enter how many rupees off.`)
    }
    if (active && total <= 0) return setError('Give at least one slice a chance above zero before switching the wheel on.')

    setBusy(true)
    setError(null)
    const { error: err } = await supabase.rpc('save_spin_wheel', {
      p_cafe_id: cafeId,
      p_title: title.trim() || 'Spin & win',
      p_active: active,
      p_expiry_days: expiryDays.trim() === '' ? null : Math.max(1, Math.round(Number(expiryDays) || 0)),
      p_segments: segments.map((s) => ({
        label: s.label.trim(),
        kind: s.kind,
        menu_item_id: s.kind === 'item' ? s.menu_item_id : null,
        variant_id: null,
        value: s.kind === 'percent' || s.kind === 'flat' ? Math.round(s.value) : 0,
        weight: Math.max(0, Math.round(s.weight)),
      })),
    })
    setBusy(false)
    if (err) return setError(err.message)
    toast(active ? 'Spin wheel saved and live.' : 'Spin wheel saved. Switch it on when you\'re ready.')
  }

  return (
    <div className="mt-5 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">Spin &amp; win</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            A guest earns one spin when their order is paid — one per order, so a prize always costs you a sale.
            You set what&apos;s on the wheel and how often each slice comes up.
          </p>
        </div>
        {canManage && (
          <label className="flex shrink-0 items-center gap-2 text-[13px] font-medium text-foreground">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-[var(--primary)]" />
            {active ? 'Live' : 'Off'}
          </label>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <Input label="Title guests see" value={title} onChange={(e) => setTitle(e.target.value)} className="w-[220px]" />
        <Input
          label="Prize expires after (days)"
          type="number"
          min={1}
          value={expiryDays}
          onChange={(e) => setExpiryDays(e.target.value)}
          hint="Leave empty for no expiry."
          className="w-[190px]"
        />
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-medium text-foreground">What&apos;s on the wheel</p>
          {canManage && (
            <button
              onClick={() => setSegments((l) => [...l, { ...emptySegment }])}
              className="text-[13px] font-medium text-primary hover:underline"
            >
              + Add slice
            </button>
          )}
        </div>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Chance is relative — a slice with twice the number comes up twice as often. The odds underneath each one are
          what actually happens.
        </p>

        <div className="mt-3 space-y-3">
          {segments.map((s, idx) => (
            <div key={idx} className="rounded-[var(--radius)] border border-border-strong p-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={s.label}
                  onChange={(e) => patch(idx, { label: e.target.value })}
                  placeholder="What the guest sees — e.g. Free Cold Coffee"
                  className="h-9 min-w-0 flex-1 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[13px] text-foreground placeholder:text-muted-foreground"
                />
                <select
                  value={s.kind}
                  onChange={(e) => patch(idx, { kind: e.target.value as SpinPrizeKind, menu_item_id: null, value: 0 })}
                  className={`${SELECT_CLS} max-w-[130px]`}
                >
                  {KINDS.map((k) => (
                    <option key={k.value} value={k.value}>{k.label}</option>
                  ))}
                </select>
                {canManage && (
                  <button
                    onClick={() => setSegments((l) => l.filter((_, i) => i !== idx))}
                    aria-label={`Remove ${s.label || 'slice'}`}
                    className="grid h-9 w-8 shrink-0 place-items-center text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                {s.kind === 'item' && (
                  <select
                    value={s.menu_item_id ?? ''}
                    onChange={(e) => patch(idx, { menu_item_id: e.target.value || null })}
                    className={`${SELECT_CLS} max-w-[260px]`}
                  >
                    <option value="">…which item is free?</option>
                    {liveItems.map((i) => (
                      <option key={i.id} value={i.id}>{i.name} · ₹{i.price}</option>
                    ))}
                  </select>
                )}
                {(s.kind === 'percent' || s.kind === 'flat') && (
                  <input
                    type="number"
                    min={s.kind === 'percent' ? 1 : 1}
                    max={s.kind === 'percent' ? 100 : undefined}
                    value={s.value || ''}
                    onChange={(e) => patch(idx, { value: Math.round(Number(e.target.value) || 0) })}
                    placeholder={s.kind === 'percent' ? '10' : '50'}
                    aria-label={s.kind === 'percent' ? 'Percent off' : 'Rupees off'}
                    className="h-9 w-24 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[13px] text-foreground"
                  />
                )}

                <span className="ml-auto flex items-center gap-2">
                  <span className="text-[12px] text-muted-foreground">Chance</span>
                  <input
                    type="number"
                    min={0}
                    value={s.weight}
                    onChange={(e) => patch(idx, { weight: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                    aria-label={`Chance for ${s.label || 'this slice'}`}
                    className="h-9 w-20 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[13px] text-foreground"
                  />
                </span>
              </div>

              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11.5px] text-muted-foreground">
                  {oneInPhrase(s.weight, total)
                    ? <>Comes up <span className="font-medium text-foreground">{oneInPhrase(s.weight, total)}</span> spins · {percentPhrase(s.weight, total)}</>
                    : 'Never comes up — give it a chance above zero.'}
                </p>
                {canManage && s.kind !== 'none' && (
                  <label className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                    <Percent size={12} /> make it 1 in
                    <input
                      type="number"
                      min={2}
                      placeholder="20"
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return
                        e.preventDefault()
                        const n = Number((e.target as HTMLInputElement).value)
                        if (n > 1) setOdds(idx, n)
                      }}
                      onBlur={(e) => {
                        const n = Number(e.target.value)
                        if (n > 1) setOdds(idx, n)
                        e.target.value = ''
                      }}
                      className="h-7 w-16 rounded-[var(--radius)] border border-border-strong bg-surface px-2 text-[12px] text-foreground"
                    />
                  </label>
                )}
              </div>
            </div>
          ))}
        </div>

        {total > 0 && (
          <p className="mt-3 text-[12px] text-muted-foreground">
            Out of every <span className="font-medium text-foreground">{total}</span> spins, each slice lands as many
            times as its chance number. Something wins on{' '}
            <span className="font-medium text-foreground">
              {percentPhrase(totalWeight(segments.filter((s) => s.kind !== 'none')), total)}
            </span>{' '}
            of spins.
          </p>
        )}
      </div>

      {error && <p className="mt-3 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">{error}</p>}

      {canManage && (
        <div className="mt-4 flex justify-end">
          <Button loading={busy} onClick={save}>Save wheel</Button>
        </div>
      )}
    </div>
  )
}
