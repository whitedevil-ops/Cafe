import Link from 'next/link'
import { Zap, Heart, Layers, TrendingUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SiteHeader } from '@/components/marketing/site-header'
import { SiteFooter } from '@/components/marketing/site-footer'
import { Hero } from '@/components/marketing/hero'
import { MetricsCounters } from '@/components/marketing/metrics-counters'
import { FeatureCards } from '@/components/marketing/feature-cards'
import { ProductShowcase } from '@/components/marketing/product-showcase'
import { ComparisonSection } from '@/components/marketing/comparison-section'
import { TestimonialSpotlight } from '@/components/marketing/testimonial-spotlight'
import { PricingCards } from '@/components/marketing/pricing-cards'
import { Reveal } from '@/components/marketing/reveal'

const VALUE_PROPS = [
  { icon: Zap, title: 'Faster orders', body: 'Less time at the counter' },
  { icon: Heart, title: 'Better retention', body: 'Regulars, not just footfall' },
  { icon: Layers, title: 'Simpler operations', body: 'One system, not five tabs' },
  { icon: TrendingUp, title: 'Real insight', body: 'Know your numbers daily' },
]

const steps = [
  ['Register your café', 'Create your account and workspace in under two minutes.'],
  ['Set up your menu', 'Add items, prices, and categories — or import what you have.'],
  ['Generate your QR', 'Every table gets a QR code, ready to print and place.'],
  ['Start taking orders', 'Counter, table, or takeaway — all in one live queue.'],
  ['Build loyalty', 'Turn first visits into regulars with points and offers.'],
]

const faqs = [
  {
    q: 'What is KhaoPiyo?',
    a: 'KhaoPiyo is a cloud POS and café operations platform — billing, QR ordering, digital menus, kitchen display (KOT/KDS), customer CRM, loyalty and analytics in one connected system, built for cafés, cloud kitchens and casual-dining restaurants in India.',
  },
  {
    q: 'Who makes KhaoPiyo?',
    a: 'KhaoPiyo is built by Ventron, a technology company based in Hisar, Haryana, India, founded by Vineet Sharma.',
  },
  {
    q: 'Who is KhaoPiyo for?',
    a: 'Independent cafés, small restaurant chains, and takeaway or cloud kitchens in India that want one system for billing, ordering and operations instead of a bill book, a spreadsheet, and a separate ordering app.',
  },
  {
    q: 'How much does KhaoPiyo cost?',
    a: 'Flat monthly plans: Starter at ₹999, Growth at ₹2,499, and Scale at ₹4,999 — shown upfront, with no hardware to buy and no separate setup fee.',
  },
  {
    q: 'Is there a free trial?',
    a: 'Yes — sign up and set up your café for free; you only move to a paid plan once you\'re ready.',
  },
  {
    q: 'Is KhaoPiyo actually live, or still in development?',
    a: 'It\'s live. KhaoPiyo\'s first café is Brewora Café in Hisar, Haryana, running real day-to-day billing, QR ordering, and GST invoicing.',
  },
]

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
}

export default function Home() {
  return (
    <div className="flex w-full min-h-dvh flex-col bg-background">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <SiteHeader />

      <Hero />

      {/* Value strip */}
      <section className="border-y border-border bg-surface">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-6 py-10 md:grid-cols-4">
          {VALUE_PROPS.map((v, i) => (
            <Reveal key={v.title} delay={i * 0.05}>
              <v.icon size={18} className="text-primary" strokeWidth={2} />
              <p className="mt-2.5 text-sm font-medium text-foreground">{v.title}</p>
              <p className="mt-1 text-[13px] text-muted-foreground">{v.body}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <MetricsCounters />

      <FeatureCards />

      <ProductShowcase />

      <div className="border-y border-border bg-surface">
        <ComparisonSection />
      </div>

      {/* How it works */}
      <section id="how" className="mx-auto w-full max-w-6xl px-6 py-20">
        <Reveal>
          <h2 className="font-display text-[clamp(1.85rem,4vw,2.75rem)] font-semibold tracking-tight text-foreground">
            Live in an afternoon.
          </h2>
        </Reveal>
        <ol className="mt-12 grid gap-8 md:grid-cols-5">
          {steps.map(([title, body], i) => (
            <Reveal key={title} delay={i * 0.06}>
              <li>
                <span className="grid h-8 w-8 place-items-center rounded-full border border-border-strong text-sm font-semibold text-foreground">
                  {i + 1}
                </span>
                <p className="mt-3 text-sm font-medium text-foreground">{title}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
              </li>
            </Reveal>
          ))}
        </ol>
      </section>

      <TestimonialSpotlight />

      <PricingCards />

      {/* Final CTA */}
      <section className="mx-auto w-full max-w-6xl px-6 py-20 text-center">
        <Reveal>
          <h2 className="font-display text-[clamp(1.85rem,4vw,2.75rem)] font-semibold tracking-tight text-foreground">
            Ready to modernize your café?
          </h2>
          <p className="mx-auto mt-3 max-w-md text-[15px] text-muted-foreground">
            Start free while you set up. Simple monthly pricing once you&apos;re taking orders — no
            lock-in, cancel anytime.
          </p>
          <div className="mt-8">
            <Link href="/get-started">
              <Button size="lg">Start free</Button>
            </Link>
          </div>
        </Reveal>
      </section>

      {/* FAQ */}
      <section className="border-t border-border bg-surface">
        <div className="mx-auto w-full max-w-3xl px-6 py-20">
          <Reveal>
            <h2 className="font-display text-[clamp(1.5rem,3.5vw,2rem)] font-semibold tracking-tight text-foreground">
              Frequently asked questions
            </h2>
          </Reveal>
          <div className="mt-10 divide-y divide-border border-t border-border">
            {faqs.map((f, i) => (
              <Reveal key={f.q} delay={Math.min(i, 4) * 0.04}>
                <div className="py-5">
                  <h3 className="text-[15px] font-medium text-foreground">{f.q}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{f.a}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
