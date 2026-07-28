'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { loadRazorpayCheckout } from '@/lib/razorpay-client'
import { Button } from '@/components/ui/button'

type Plan = {
  key: string; name: string
  price_monthly: number; price_yearly: number | null; renewal_price_yearly: number | null
  available: boolean
}

// Shown only on the suspended-for-expiry dashboard blocker (app/dashboard/
// layout.tsx) — a café stuck there must still be able to renew without
// reaching the normal (blocked) dashboard/billing page. platform_billing_
// state and /api/platform-billing/subscribe both only check the caller's
// cafe_members role, never cafes.status, so this works for a suspended
// café without any special-casing on their side.
export function ExpiryRenewal({ cafeId }: { cafeId: string }) {
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [busyPlan, setBusyPlan] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const supabase = createClient()
      const { data } = await supabase.rpc('platform_billing_state', { p_cafe_id: cafeId })
      if (!cancelled && data) setPlans((data as { plans: Plan[] }).plans)
    }
    void load()
    return () => { cancelled = true }
  }, [cafeId])

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
          // Confirmed only once the webhook flips billing_status/status —
          // a full reload re-runs the dashboard layout's server-side check,
          // which unblocks automatically the moment that's landed.
          void (async () => {
            await new Promise((r) => setTimeout(r, 3000))
            window.location.reload()
          })()
        },
        modal: { ondismiss: () => setBusyPlan(null) },
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

  if (!plans) return <p className="mt-6 text-sm text-muted-foreground">Loading plans…</p>

  const available = plans.filter((p) => p.available)
  if (available.length === 0) {
    return (
      <p className="mt-6 text-[13px] text-muted-foreground">
        Online renewal isn&apos;t set up yet — contact support to renew.
      </p>
    )
  }

  return (
    <div className="mt-6">
      {error && (
        <p className="mb-3 rounded-[var(--radius)] bg-destructive-subtle px-3 py-2 text-[13px] text-destructive">{error}</p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        {available.map((p) => (
          <div key={p.key} className="rounded-[var(--radius-lg)] border border-border bg-surface p-4 text-left">
            <p className="text-[13.5px] font-semibold text-foreground">{p.name}</p>
            {p.price_yearly ? (
              <p className="mt-1 text-lg font-semibold tracking-tight text-foreground">
                ₹{p.price_yearly.toLocaleString('en-IN')}<span className="text-[12px] font-normal text-muted-foreground">/yr</span>
              </p>
            ) : (
              <p className="mt-1 text-lg font-semibold tracking-tight text-foreground">Free</p>
            )}
            <Button className="mt-3 w-full" size="sm" loading={busyPlan === p.key} onClick={() => subscribe(p.key)}>
              Renew
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
