'use client'

import { useMemo, useState } from 'react'
import { Check, CreditCard } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { loadRazorpayCheckout } from '@/lib/razorpay-client'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { useToast } from '@/components/ui/toast'

export type BillingState = {
  plan: string
  plan_name: string | null
  price_monthly: number | null
  price_yearly: number | null
  renewal_price_yearly: number | null
  billing_status: string
  subscription_ends_at: string | null
  status: string
  plans: { key: string; name: string; price_monthly: number; price_yearly: number | null; renewal_price_yearly: number | null; available: boolean }[]
}

const STATUS_LABEL: Record<string, string> = {
  none: 'No active subscription',
  created: 'Checkout started',
  active: 'Active',
  past_due: 'Payment issue — retrying',
  cancelled: 'Cancelled',
}

export default function BillingClient({
  cafeId,
  role,
  initialState,
}: {
  cafeId: string
  role: string
  initialState: BillingState | null
}) {
  const supabase = useMemo(() => createClient(), [])
  const { toast } = useToast()
  const [state, setState] = useState(initialState)
  const [busyPlan, setBusyPlan] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isOwner = role === 'owner'

  async function refresh() {
    const { data } = await supabase.rpc('platform_billing_state', { p_cafe_id: cafeId })
    if (data) setState(data as BillingState)
  }

  async function subscribe(planKey: string) {
    setBusyPlan(planKey)
    setError(null)
    try {
      const res = await fetch('/api/platform-billing/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan_key: planKey }),
      })
      const cfg = await res.json()
      if (!res.ok) {
        setError(cfg.error ?? 'Could not start billing.')
        setBusyPlan(null)
        return
      }

      const loaded = await loadRazorpayCheckout()
      if (!loaded || !window.Razorpay) {
        setError('Could not load the payment widget.')
        setBusyPlan(null)
        return
      }

      const rzp = new window.Razorpay({
        key: cfg.key_id,
        subscription_id: cfg.subscription_id,
        name: 'KhaoPiyo',
        description: `${cfg.plan_name} plan`,
        theme: { color: '#C2410C' },
        handler: () => {
          // Razorpay confirms success client-side, but the plan only actually
          // changes once the verified webhook fires — poll for that instead
          // of trusting this callback.
          void (async () => {
            for (let i = 0; i < 10; i++) {
              await new Promise((r) => setTimeout(r, 1500))
              await refresh()
            }
            setBusyPlan(null)
            toast('Subscription started — this updates automatically once payment is confirmed.')
          })()
        },
        modal: {
          ondismiss: () => setBusyPlan(null),
        },
      })
      rzp.on('payment.failed', () => {
        setError('Payment failed. You can try again.')
        setBusyPlan(null)
      })
      rzp.open()
    } catch {
      setError('Could not reach the billing service.')
      setBusyPlan(null)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Billing" subtitle="Your KhaoPiyo subscription — not your café's own customer payments." />

      {!state ? (
        <Card><p className="text-sm text-muted-foreground">Could not load billing information.</p></Card>
      ) : (
        <>
          <Card>
            <CardHeader
              title={state.plan_name ?? state.plan}
              description={
                state.subscription_ends_at
                  ? `Renews ${new Date(state.subscription_ends_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
                  : undefined
              }
              action={
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border-strong px-3 py-1 text-[12.5px] font-medium text-foreground">
                  <CreditCard size={13} /> {STATUS_LABEL[state.billing_status] ?? state.billing_status}
                </span>
              }
            />
          </Card>

          {error && <p className="rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">{error}</p>}

          {isOwner ? (
            <div className="grid gap-4 sm:grid-cols-3">
              {state.plans.map((p) => {
                const current = p.key === state.plan
                return (
                  <Card key={p.key} className={current ? 'border-primary' : ''}>
                    <h3 className="text-[15px] font-semibold text-foreground">{p.name}</h3>
                    {p.price_yearly ? (
                      <>
                        <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
                          ₹{p.price_yearly.toLocaleString('en-IN')}<span className="text-[13px] font-normal text-muted-foreground">/yr</span>
                        </p>
                        {p.renewal_price_yearly && (
                          <p className="mt-0.5 text-[12px] text-muted-foreground">
                            Renews at ₹{p.renewal_price_yearly.toLocaleString('en-IN')}/yr
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">Free</p>
                    )}
                    {current ? (
                      <p className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-primary"><Check size={14} /> Current plan</p>
                    ) : (
                      <Button
                        className="mt-4 w-full"
                        variant={p.available ? 'primary' : 'secondary'}
                        disabled={!p.available}
                        loading={busyPlan === p.key}
                        onClick={() => subscribe(p.key)}
                      >
                        {p.available ? 'Switch to this plan' : 'Not yet available'}
                      </Button>
                    )}
                  </Card>
                )
              })}
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">Only the café owner can change the billing plan.</p>
          )}
        </>
      )}
    </div>
  )
}
