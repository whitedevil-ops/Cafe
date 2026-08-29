'use client'

import { useMemo, useState } from 'react'
import { Trash2, Percent, ChevronUp, ChevronDown, Volume2, Sparkles } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { WheelDial } from '@/components/spin-wheel-dial'
import {
  type SpinSegment,
  type SpinWheel,
  type SpinPrizeKind,
  WHEEL_PALETTE,
  totalWeight,
  oneInPhrase,
  percentPhrase,
  weightsForOneIn,
} from '@/lib/spin-wheel'

type MenuItemLite = { id: string; name: string; price: number; archived: boolean }
type VariantLite = { id: string; menu_item_id: string; name: string }

const SELECT_CLS =
  'h-9 w-full min-w-0 rounded-[var(--radius)] border border-border-strong bg-surface px-2 text-[13px] text-foreground'

const KINDS: { value: SpinPrizeKind; label: string }[] = [
  { value: 'item', label: 'Free item' },
  { value: 'percent', label: '% off' },
  { value: 'flat', label: '₹ off' },
  { value: 'none', label: 'No prize' },
]

const emptySegment: SpinSegment = { label: '', kind: 'none', menu_item_id: null, variant_id: null, value: 0, weight: 1, color: null }

// A wheel that only ever pays out is a wheel that bankrupts the café, so a new
// one starts with losing slices already outnumbering the prize.
const STARTER: SpinSegment[] = [
  { label: 'Better luck next time', kind: 'none', menu_item_id: null, variant_id: null, value: 0, weight: 10, color: null },
  { label: '10% off next visit', kind: 'percent', menu_item_id: null, variant_id: null, value: 10, weight: 6, color: null },
  { label: '₹50 off next visit', kind: 'flat', menu_item_id: null, variant_id: null, value: 50, weight: 3, color: null },
  { label: 'Free item', kind: 'item', menu_item_id: null, variant_id: null, value: 0, weight: 1, color: null },
]

export default function SpinWheelPanel({
  cafeId,
  canManage,
  items,
  itemVariants,
  initialWheel,
  initialSegments,
}: {
  cafeId: string
  canManage: boolean
  items: MenuItemLite[]
  itemVariants: VariantLite[]
  initialWheel: SpinWheel | null
  initialSegments: SpinSegment[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const { toast } = useToast()

  const [title, setTitle] = useState(initialWheel?.title ?? 'Spin & win')
  const [subtitle, setSubtitle] = useState(initialWheel?.subtitle ?? '')
  const [active, setActive] = useState(initialWheel?.active ?? false)
  const [expiryDays, setExpiryDays] = useState(initialWheel?.expiry_days == null ? '' : String(initialWheel.expiry_days))
  const [minOrderAmount, setMinOrderAmount] = useState(String(initialWheel?.min_order_amount ?? 0))
  const [enableConfetti, setEnableConfetti] = useState(initialWheel?.enable_confetti ?? true)
  const [enableSound, setEnableSound] = useState(initialWheel?.enable_sound ?? true)
  const [segments, setSegments] = useState<SpinSegment[]>(
    initialSegments.length > 0 ? initialSegments : STARTER,
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const liveItems = useMemo(() => items.filter((i) => !i.archived), [items])
  const variantsByItem = useMemo(() => {
    const m = new Map<string, VariantLite[]>()
    itemVariants.forEach((v) => m.set(v.menu_item_id, [...(m.get(v.menu_item_id) ?? []), v]))
    return m
  }, [itemVariants])
  const total = totalWeight(segments)

  function patch(idx: number, next: Partial<SpinSegment>) {
    setSegments((list) => list.map((s, i) => (i === idx ? { ...s, ...next } : s)))
  }

  function move(idx: number, dir: -1 | 1) {
    setSegments((list) => {
      const next = [...list]
      const j = idx + dir
      if (j < 0 || j >= next.length) return list
      ;[next[idx], next[j]] = [next[j], next[idx]]
      return next
    })
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
      p_subtitle: subtitle.trim() || null,
      p_active: active,
      p_expiry_days: expiryDays.trim() === '' ? null : Math.max(1, Math.round(Number(expiryDays) || 0)),
      p_min_order_amount: Math.max(0, Math.round(Number(minOrderAmount) || 0)),
      p_enable_confetti: enableConfetti,
      p_enable_sound: enableSound,
      p_segments: segments.map((s) => ({
        label: s.label.trim(),
        kind: s.kind,
        menu_item_id: s.kind === 'item' ? s.menu_item_id : null,
        variant_id: s.kind === 'item' ? s.variant_id : null,
        value: s.kind === 'percent' || s.kind === 'flat' ? Math.round(s.value) : 0,
        weight: Math.max(0, Math.round(s.weight)),
        color: s.color,
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

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_auto]">
        <div>
          <div className="flex flex-wrap gap-3">
            <Input label="Title guests see" value={title} onChange={(e) => setTitle(e.target.value)} className="w-[220px]" disabled={!canManage} />
            <Input label="Subtitle (optional)" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="Spin and unlock exciting rewards!" className="w-[260px]" disabled={!canManage} />
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            <Input
              label="Prize expires after (days)" type="number" min={1} value={expiryDays}
              onChange={(e) => setExpiryDays(e.target.value)} hint="Leave empty for no expiry." className="w-[190px]" disabled={!canManage}
            />
            <Input
              label="Minimum order amount (₹)" type="number" min={0} value={minOrderAmount}
              onChange={(e) => setMinOrderAmount(e.target.value)} hint="Leave 0 to enable for any amount." className="w-[190px]" disabled={!canManage}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-4">
            <label className="flex items-center gap-1.5 text-[12.5px] font-medium text-foreground">
              <input type="checkbox" checked={enableConfetti} onChange={(e) => setEnableConfetti(e.target.checked)} disabled={!canManage} className="accent-[var(--primary)]" />
              <Sparkles size={13} className="text-muted-foreground" /> Confetti on win
            </label>
            <label className="flex items-center gap-1.5 text-[12.5px] font-medium text-foreground">
              <input type="checkbox" checked={enableSound} onChange={(e) => setEnableSound(e.target.checked)} disabled={!canManage} className="accent-[var(--primary)]" />
              <Volume2 size={13} className="text-muted-foreground" /> Sound on spin &amp; win
            </label>
          </div>
        </div>

        <div className="flex flex-col items-center gap-1.5 justify-self-center">
          <p className="text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">Wheel preview</p>
          <WheelDial segments={segments} size={148} />
        </div>
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
          {segments.map((s, idx) => {
            const segVariants = s.menu_item_id ? (variantsByItem.get(s.menu_item_id) ?? []) : []
            const swatch = s.color || WHEEL_PALETTE[idx % WHEEL_PALETTE.length]
            return (
              <div key={idx} className="rounded-[var(--radius)] border border-border-strong p-3">
                <div className="flex flex-wrap items-center gap-2">
                  {canManage && (
                    <div className="flex shrink-0 flex-col">
                      <button onClick={() => move(idx, -1)} disabled={idx === 0} aria-label="Move up" className="grid h-4 w-6 place-items-center text-muted-foreground hover:text-foreground disabled:opacity-30">
                        <ChevronUp size={12} />
                      </button>
                      <button onClick={() => move(idx, 1)} disabled={idx === segments.length - 1} aria-label="Move down" className="grid h-4 w-6 place-items-center text-muted-foreground hover:text-foreground disabled:opacity-30">
                        <ChevronDown size={12} />
                      </button>
                    </div>
                  )}
                  <input
                    value={s.label}
                    onChange={(e) => patch(idx, { label: e.target.value })}
                    placeholder="What the guest sees — e.g. Free Cold Coffee"
                    className="h-9 min-w-0 flex-1 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[13px] text-foreground placeholder:text-muted-foreground"
                    disabled={!canManage}
                  />
                  <select
                    value={s.kind}
                    onChange={(e) => patch(idx, { kind: e.target.value as SpinPrizeKind, menu_item_id: null, variant_id: null, value: 0 })}
                    className={`${SELECT_CLS} max-w-[130px]`}
                    disabled={!canManage}
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
                    <>
                      <select
                        value={s.menu_item_id ?? ''}
                        onChange={(e) => patch(idx, { menu_item_id: e.target.value || null, variant_id: null })}
                        className={`${SELECT_CLS} max-w-[220px]`}
                        disabled={!canManage}
                      >
                        <option value="">…which item is free?</option>
                        {liveItems.map((i) => (
                          <option key={i.id} value={i.id}>{i.name} · ₹{i.price}</option>
                        ))}
                      </select>
                      {segVariants.length > 0 && (
                        <select
                          value={s.variant_id ?? ''}
                          onChange={(e) => patch(idx, { variant_id: e.target.value || null })}
                          className={`${SELECT_CLS} max-w-[140px]`}
                          disabled={!canManage}
                        >
                          <option value="">Any size</option>
                          {segVariants.map((v) => (
                            <option key={v.id} value={v.id}>{v.name}</option>
                          ))}
                        </select>
                      )}
                    </>
                  )}
                  {(s.kind === 'percent' || s.kind === 'flat') && (
                    <input
                      type="number"
                      min={1}
                      max={s.kind === 'percent' ? 100 : undefined}
                      value={s.value || ''}
                      onChange={(e) => patch(idx, { value: Math.round(Number(e.target.value) || 0) })}
                      placeholder={s.kind === 'percent' ? '10' : '50'}
                      aria-label={s.kind === 'percent' ? 'Percent off' : 'Rupees off'}
                      className="h-9 w-24 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[13px] text-foreground"
                      disabled={!canManage}
                    />
                  )}

                  <div className="ml-auto flex items-center gap-1">
                    {canManage
                      ? WHEEL_PALETTE.map((c) => (
                          <button
                            key={c}
                            onClick={() => patch(idx, { color: c })}
                            aria-label={`Use color ${c}`}
                            className="h-5 w-5 shrink-0 rounded-full ring-offset-1"
                            style={{ backgroundColor: c, boxShadow: swatch === c ? `0 0 0 2px var(--surface), 0 0 0 3.5px ${c}` : undefined }}
                          />
                        ))
                      : <span className="h-5 w-5 rounded-full" style={{ backgroundColor: swatch }} />}
                  </div>

                  <span className="flex items-center gap-2">
                    <span className="text-[12px] text-muted-foreground">Chance</span>
                    <input
                      type="number"
                      min={0}
                      value={s.weight}
                      onChange={(e) => patch(idx, { weight: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                      aria-label={`Chance for ${s.label || 'this slice'}`}
                      className="h-9 w-20 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[13px] text-foreground"
                      disabled={!canManage}
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
            )
          })}
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
