import Link from 'next/link'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Reveal } from './reveal'

// Real numbers, matching /pos-billing-software and platform_plans exactly —
// this section is a restyle, not new pricing.
const PLANS = [
  {
    name: 'Starter',
    monthly: 999,
    yearly: 10000,
    blurb: 'Billing and QR ordering for a single counter.',
    features: ['POS billing & KOT', 'QR ordering', 'Up to 3 staff', 'GST invoicing'],
    recommended: false,
  },
  {
    name: 'Growth',
    monthly: 2499,
    yearly: 18000,
    blurb: 'Everything a growing café needs to build repeat business.',
    features: ['Everything in Starter', 'Loyalty & coupons', 'Online payments (UPI)', 'Up to 8 staff'],
    recommended: true,
  },
  {
    name: 'Scale',
    monthly: 4999,
    yearly: 21000,
    blurb: 'Multi-outlet operations with full inventory control.',
    features: ['Everything in Growth', 'Inventory & recipes', 'No staff cap', 'Advanced analytics'],
    recommended: false,
  },
] as const

export function PricingCards() {
  return (
    <section id="pricing" className="mx-auto w-full max-w-6xl px-6 py-20">
      <Reveal className="text-center">
        <h2 className="font-display text-[clamp(1.85rem,4vw,2.75rem)] font-semibold tracking-tight text-foreground">
          Simple, upfront pricing.
        </h2>
        <p className="mx-auto mt-3 max-w-md text-[15px] text-muted-foreground">
          Start free while you set up. No hardware to buy, no lock-in, cancel anytime.
        </p>
      </Reveal>

      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {PLANS.map((p, i) => (
          <Reveal key={p.name} delay={i * 0.08}>
            <div
              className={`relative flex h-full flex-col rounded-2xl border p-7 transition-[transform,box-shadow] duration-200 hover:-translate-y-1.5 hover:shadow-xl ${
                p.recommended ? 'border-primary bg-surface shadow-lg' : 'border-border bg-surface hover:border-border-strong'
              }`}
            >
              {p.recommended && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-[11px] font-medium text-primary-foreground">
                  Recommended
                </span>
              )}
              <p className="text-[15px] font-medium text-foreground">{p.name}</p>
              <p className="mt-1 text-[13px] text-muted-foreground">{p.blurb}</p>
              <div className="mt-5 flex items-baseline gap-1">
                <span className="font-display text-4xl font-semibold tracking-tight text-foreground">₹{p.monthly.toLocaleString('en-IN')}</span>
                <span className="text-[13px] text-muted-foreground">/month</span>
              </div>
              <p className="mt-1 text-[12.5px] text-muted-foreground">or ₹{p.yearly.toLocaleString('en-IN')}/year</p>
              <ul className="mt-6 flex-1 space-y-2.5">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-[13.5px] text-foreground">
                    <Check size={16} className="mt-0.5 shrink-0 text-primary" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link href="/get-started" className="mt-7">
                <Button size="lg" variant={p.recommended ? 'primary' : 'secondary'} className="w-full">
                  Start free
                </Button>
              </Link>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  )
}
