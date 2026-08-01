'use client'

import {
  CreditCard, QrCode, MonitorSmartphone, Boxes, BarChart3,
  Users, Wallet, Gift, ChefHat, LineChart,
} from 'lucide-react'
import { Reveal } from './reveal'

// Every card below names a capability that's actually shipped — matched to
// the real feature set in app/platform-admin/cafes/[id]/cafe-detail-client.tsx
// (FEATURES + ALWAYS_INCLUDED), so this section never promises something
// the product doesn't have yet.
const FEATURES = [
  {
    icon: CreditCard,
    title: 'Point of sale',
    body: 'A fast, keyboard-friendly POS your staff learn in a shift. Variants, add-ons, discounts, split payments — no lag at the counter.',
  },
  {
    icon: QrCode,
    title: 'QR ordering',
    body: 'Guests scan, browse, and order from their table. No app to install, no login to force. Orders land straight in the kitchen.',
  },
  {
    icon: MonitorSmartphone,
    title: 'Kitchen Display',
    body: 'A live KDS screen replaces shouted tickets — every order shows up instantly, moves through Preparing → Ready → Served.',
  },
  {
    icon: Boxes,
    title: 'Inventory',
    body: 'Stock moves automatically as orders go out. Low-stock alerts on the owner dashboard, before you run out mid-service.',
  },
  {
    icon: BarChart3,
    title: 'Reports',
    body: "Sales, items, GST, payments, adjustments and operations — nine focused reports, not one overwhelming dashboard.",
  },
  {
    icon: Users,
    title: 'Customer CRM',
    body: 'Every order quietly builds a customer profile — visits, spend, favourites — so you know your regulars without asking.',
  },
  {
    icon: Wallet,
    title: 'Payments',
    body: 'Pay at counter or online via UPI — Razorpay connects directly to your own account, funds settle straight to you.',
  },
  {
    icon: Gift,
    title: 'Loyalty',
    body: 'Points that actually bring people back, on rules you set. Balances come from an immutable ledger, never a number you can fat-finger.',
  },
  {
    icon: ChefHat,
    title: 'Recipes',
    body: 'Cost every dish from its ingredients, see real margins per item, and let orders deduct stock automatically if you want that.',
  },
  {
    icon: LineChart,
    title: 'Analytics',
    body: "Today's sales, average order value, peak hours, best sellers. The numbers an owner checks at 11pm, on their phone.",
  },
] as const

export function FeatureCards() {
  return (
    <section id="features" className="mx-auto w-full max-w-6xl px-6 py-20">
      <Reveal>
        <h2 className="font-display max-w-xl text-[clamp(1.85rem,4vw,2.75rem)] font-semibold tracking-tight text-foreground">
          Everything your café needs, nothing it doesn&apos;t.
        </h2>
      </Reveal>
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f, i) => (
          <Reveal key={f.title} delay={Math.min(i, 5) * 0.05}>
            <div className="group h-full rounded-2xl border border-border bg-surface p-6 transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-1 hover:border-border-strong hover:shadow-lg">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary-subtle text-primary transition-transform duration-200 group-hover:scale-110">
                <f.icon size={20} strokeWidth={2} />
              </div>
              <h3 className="mt-4 text-base font-medium text-foreground">{f.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{f.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  )
}
