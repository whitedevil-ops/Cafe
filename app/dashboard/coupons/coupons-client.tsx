'use client'

import { useMemo, useState } from 'react'
import { Tag, Percent, IndianRupee } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useToast } from '@/components/ui/toast'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardHeader } from '@/components/ui/card'
import { formatDate } from '@/lib/datetime'

export type Coupon = {
  id: string
  code: string
  name: string | null
  kind: 'percent' | 'flat' | 'bogo' | 'free_item' | 'min_order'
  value: number
  min_order: number
  max_discount: number | null
  starts_at: string | null
  ends_at: string | null
  usage_limit: number | null
  per_customer: number | null
  active: boolean
  created_at: string
}

export type CouponStat = {
  coupon_id: string
  redemptions: number
  total_discounted: number
  last_used_at: string | null
}

function Toggle({ on, disabled, onClick }: { on: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      role="switch" aria-checked={on} aria-label="Active" disabled={disabled} onClick={onClick}
      className={`h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${on ? 'bg-primary' : 'border border-border-strong bg-surface-subtle'}`}
    >
      <span className={`block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  )
}

function toStartOfDayISO(d: string) {
  return d ? new Date(`${d}T00:00:00`).toISOString() : null
}
function toEndOfDayISO(d: string) {
  return d ? new Date(`${d}T23:59:59`).toISOString() : null
}

export default function CouponsClient({
  cafeId,
  role,
  initialCoupons,
  initialStats,
}: {
  cafeId: string
  role: string
  initialCoupons: Coupon[]
  initialStats: CouponStat[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const { toast } = useToast()
  const isAdmin = role === 'owner' || role === 'manager'

  const [coupons, setCoupons] = useState(initialCoupons)
  const statsByCoupon = useMemo(() => new Map(initialStats.map((s) => [s.coupon_id, s])), [initialStats])

  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'percent' | 'flat'>('percent')
  const [value, setValue] = useState('')
  const [minOrder, setMinOrder] = useState('')
  const [maxDiscount, setMaxDiscount] = useState('')
  const [usageLimit, setUsageLimit] = useState('')
  const [perCustomer, setPerCustomer] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function createCoupon() {
    const v = Math.round(Number(value))
    if (!v || v <= 0) return setError('Enter a value greater than 0.')
    if (kind === 'percent' && v > 100) return setError('A percentage coupon cannot exceed 100.')
    setSaving(true)
    setError(null)
    const { data, error: err } = await supabase.rpc('create_coupon', {
      p_cafe_id: cafeId,
      p_code: code,
      p_name: name.trim() || null,
      p_kind: kind,
      p_value: v,
      p_min_order: minOrder ? Math.round(Number(minOrder)) : 0,
      p_max_discount: kind === 'percent' && maxDiscount ? Math.round(Number(maxDiscount)) : null,
      p_starts_at: toStartOfDayISO(startsAt),
      p_ends_at: toEndOfDayISO(endsAt),
      p_usage_limit: usageLimit ? Math.round(Number(usageLimit)) : null,
      p_per_customer: perCustomer ? Math.round(Number(perCustomer)) : null,
    })
    setSaving(false)
    if (err) return setError(err.message)
    setCoupons((list) => [data as Coupon, ...list])
    setCode(''); setName(''); setValue(''); setMinOrder(''); setMaxDiscount('')
    setUsageLimit(''); setPerCustomer(''); setStartsAt(''); setEndsAt('')
    toast(`Coupon ${(data as Coupon).code} created.`)
  }

  async function toggleActive(c: Coupon) {
    setCoupons((list) => list.map((x) => (x.id === c.id ? { ...x, active: !x.active } : x)))
    const { error: err } = await supabase.rpc('set_coupon_active', { p_coupon_id: c.id, p_active: !c.active })
    if (err) {
      setCoupons((list) => list.map((x) => (x.id === c.id ? { ...x, active: c.active } : x)))
      toast(err.message, 'error')
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:py-8">
      <PageHeader
        title="Coupons & offers"
        subtitle="Every discount is validated and redeemed server-side — a browser can never claim a bigger amount than the coupon actually grants."
      />

      {!isAdmin && (
        <p className="mt-4 rounded-[var(--radius)] bg-warning-subtle px-3 py-2.5 text-[13px] text-warning">
          View only — your role ({role}) can’t create or change coupons.
        </p>
      )}

      {isAdmin && (
        <Card className="mt-6">
          <CardHeader title="Create a coupon" description="Percentage or flat-amount only — other coupon types need staff to apply them manually." />
          <div className="mt-5 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="SAVE10" />
              <Input label="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} placeholder="Weekday lunch offer" />
            </div>

            <div className="flex gap-2">
              {([['percent', 'Percentage', <Percent key="p" size={14} />], ['flat', 'Flat amount', <IndianRupee key="f" size={14} />]] as const).map(([k, label, icon]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={`inline-flex min-h-10 items-center gap-1.5 rounded-[var(--radius)] border px-4 text-[13px] font-medium ${
                    kind === k ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-muted-foreground hover:bg-surface-subtle'
                  }`}
                >
                  {icon} {label}
                </button>
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label={kind === 'percent' ? 'Percentage off' : 'Amount off (₹)'}
                type="number" min={1} max={kind === 'percent' ? 100 : undefined}
                value={value} onChange={(e) => setValue(e.target.value)}
              />
              <Input label="Minimum order (optional)" type="number" min={0} value={minOrder} onChange={(e) => setMinOrder(e.target.value)} />
            </div>

            {kind === 'percent' && (
              <Input label="Maximum discount cap (optional)" type="number" min={1} value={maxDiscount} onChange={(e) => setMaxDiscount(e.target.value)}
                hint="Caps the rupee amount a percentage coupon can take off a large bill." />
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Total uses allowed (optional)" type="number" min={1} value={usageLimit} onChange={(e) => setUsageLimit(e.target.value)}
                hint="Leave blank for unlimited." />
              <Input label="Uses per customer (optional)" type="number" min={1} value={perCustomer} onChange={(e) => setPerCustomer(e.target.value)}
                hint="Needs the customer's phone number to enforce." />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Starts (optional)" type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
              <Input label="Ends (optional)" type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </div>

            {error && <p className="rounded-[var(--radius)] bg-destructive-subtle px-3 py-2.5 text-[13px] text-destructive">{error}</p>}
            <Button onClick={createCoupon} loading={saving}>Create coupon</Button>
          </div>
        </Card>
      )}

      <div className="mt-8">
        <p className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">All coupons</p>
        {coupons.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No coupons yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {coupons.map((c) => {
              const stat = statsByCoupon.get(c.id)
              const unsupported = c.kind !== 'percent' && c.kind !== 'flat'
              return (
                <li key={c.id} className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Tag size={15} className="text-primary" />
                        <span className="font-mono text-[14px] font-semibold text-foreground">{c.code}</span>
                        {c.name && <span className="text-[13px] text-muted-foreground">— {c.name}</span>}
                      </div>
                      <p className="mt-1 text-[13px] text-muted-foreground">
                        {unsupported
                          ? 'Unsupported here — apply manually'
                          : c.kind === 'percent'
                            ? `${c.value}% off${c.max_discount ? `, capped at ₹${c.max_discount}` : ''}`
                            : `₹${c.value} off`}
                        {c.min_order > 0 && ` · min. order ₹${c.min_order}`}
                        {c.usage_limit && ` · ${c.usage_limit} total uses`}
                        {c.per_customer && ` · ${c.per_customer} per customer`}
                      </p>
                      {(c.starts_at || c.ends_at) && (
                        <p className="mt-0.5 text-[12px] text-muted-foreground">
                          {c.starts_at ? formatDate(c.starts_at) : 'Now'} – {c.ends_at ? formatDate(c.ends_at) : 'No end date'}
                        </p>
                      )}
                      <p className="mt-1 text-[12px] text-muted-foreground">
                        {stat?.redemptions ?? 0} redemption{(stat?.redemptions ?? 0) === 1 ? '' : 's'}
                        {stat && stat.total_discounted > 0 && ` · ₹${stat.total_discounted.toLocaleString('en-IN')} given away`}
                      </p>
                    </div>
                    <Toggle on={c.active} disabled={!isAdmin} onClick={() => toggleActive(c)} />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
