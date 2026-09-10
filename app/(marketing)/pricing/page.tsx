import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteHeader } from '@/components/marketing/site-header'
import { SiteFooter } from '@/components/marketing/site-footer'
import { PricingCards } from '@/components/marketing/pricing-cards'
import { Button } from '@/components/ui/button'
import { SITE_URL, faqJsonLd, breadcrumbJsonLd, jsonLdGraph, type Faq } from '@/lib/seo'

export const metadata: Metadata = {
  title: 'Pricing — Restaurant POS Software Price in India',
  description:
    'KhaoPiyo pricing: ₹999, ₹2,499 or ₹4,999 a month for café and restaurant POS billing, QR ordering, GST invoicing and inventory. No hardware to buy, no lock-in.',
  keywords: [
    'restaurant POS software price', 'restaurant POS software pricing India',
    'restaurant billing software price', 'cafe POS software cost',
    'POS software monthly price India', 'restaurant software pricing',
  ],
  alternates: { canonical: '/pricing' },
  openGraph: {
    title: 'Restaurant POS Software Pricing · KhaoPiyo',
    description:
      'Three plans from ₹999/month for café and restaurant POS billing, QR ordering, GST invoicing and inventory. Start free while you set up.',
    url: `${SITE_URL}/pricing`,
    type: 'website',
  },
}

// Answers the questions a restaurant owner actually asks before paying, not
// the ones that flatter the product. Where the honest answer is "no", it says
// no — a pricing page that hedges is the one that wastes a sales call.
const faqs: Faq[] = [
  {
    q: 'How much does restaurant POS software cost in India?',
    a: 'It varies widely — from free tools with limited billing to enterprise systems quoted per outlet with setup and hardware charges on top. KhaoPiyo publishes three plans: ₹999, ₹2,499 and ₹4,999 per month, or ₹10,000, ₹18,000 and ₹21,000 paid yearly. The price on the page is the price; there is no separate setup fee.',
  },
  {
    q: 'Is there a free trial?',
    a: 'Yes. You can register your café and set up your menu, tables and staff before paying anything. The trial starts automatically when the café is created, so there is nothing to activate.',
  },
  {
    q: 'Do I need to buy hardware or a POS terminal?',
    a: 'No. KhaoPiyo runs in a web browser on a computer, laptop or tablet you already own. A thermal printer is optional — the kitchen display works without one, and printing goes through a printer already installed on that computer.',
  },
  {
    q: 'What happens if I go over my plan\'s staff limit?',
    a: 'Starter covers up to 3 staff accounts and Growth up to 8; Scale has no cap. If you need more seats than your plan allows, moving up a plan is the way to get them — accounts are not billed individually on top.',
  },
  {
    q: 'Is GST billing included on every plan?',
    a: 'Yes. GST-correct invoicing — sequential invoice numbers, CGST/SGST split and HSN/SAC codes — is part of billing itself, not a paid add-on. Inventory, loyalty and advanced analytics are what differ between plans.',
  },
  {
    q: 'Can I cancel, and what happens to my data?',
    a: 'You can cancel at any time; there is no lock-in contract. Your bills, menu and reports remain exportable to Excel and PDF from the dashboard while your account is active, so you can take your records with you.',
  },
  {
    q: 'Do you charge a percentage of my sales?',
    a: 'No. KhaoPiyo charges a flat monthly or yearly subscription and takes no cut of your revenue. If you connect online payments, your payment provider charges its own transaction fee directly — that is between you and them.',
  },
]

const includedEverywhere = [
  'POS billing with KOT and kitchen display',
  'QR ordering from the guest\'s own phone',
  'GST-correct tax invoices on every bill',
  'Table management and live floor view',
  'Digital menu with photos and sizes',
  'Sales, payments and day-close reports',
]

export default function PricingPage() {
  return (
    <div className="min-h-dvh bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdGraph(
            faqJsonLd(faqs),
            breadcrumbJsonLd([{ name: 'Pricing', path: '/pricing' }]),
          ),
        }}
      />
      <SiteHeader />

      <section className="mx-auto w-full max-w-4xl px-6 pt-20 pb-8 text-center">
        <p className="text-[13px] font-medium uppercase tracking-wide text-primary">Pricing</p>
        <h1 className="mt-3 font-display text-[clamp(2rem,5vw,3.25rem)] font-semibold tracking-tight text-foreground">
          Restaurant POS software pricing, published upfront.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-[16px] leading-relaxed text-muted-foreground">
          Three plans, billed monthly or yearly. No hardware to buy, no setup fee, no cut of your
          sales, and no quote to chase. Start free while you get your menu in.
        </p>
      </section>

      <PricingCards />

      <section className="border-y border-border bg-surface">
        <div className="mx-auto w-full max-w-4xl px-6 py-16">
          <h2 className="text-[clamp(1.5rem,3.5vw,2rem)] font-semibold tracking-tight text-foreground">
            On every plan, including the cheapest
          </h2>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            Billing that is correct and a kitchen that knows what to cook are not upgrades. What
            changes between plans is how much of the business you want to run on top of them.
          </p>
          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {includedEverywhere.map((f) => (
              <li key={f} className="rounded-xl border border-border bg-background px-4 py-3 text-[14px] text-foreground">
                {f}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto w-full max-w-4xl px-6 py-16">
        <h2 className="text-[clamp(1.5rem,3.5vw,2rem)] font-semibold tracking-tight text-foreground">
          Which plan fits
        </h2>
        <div className="mt-8 space-y-4">
          <div className="rounded-xl border border-border bg-surface p-5">
            <p className="text-[15px] font-medium text-foreground">Starter — a single counter</p>
            <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
              One café or small restaurant moving off a paper bill book or a calculator. You get
              billing, QR ordering and GST invoices with up to three staff accounts.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-surface p-5">
            <p className="text-[15px] font-medium text-foreground">Growth — a café with regulars</p>
            <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
              Adds loyalty, coupons and online UPI payments — the tools for getting the same guest
              back rather than only serving the one in front of you. Up to eight staff.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-surface p-5">
            <p className="text-[15px] font-medium text-foreground">Scale — when stock is the problem</p>
            <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
              Adds inventory, recipes and food costing, plus advanced analytics and no cap on staff
              accounts. The plan for an operation where wastage and margin matter as much as sales.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-3xl px-6 py-16">
        <h2 className="text-[clamp(1.5rem,3.5vw,2rem)] font-semibold tracking-tight text-foreground">
          Pricing questions
        </h2>
        <div className="mt-10 divide-y divide-border border-t border-border">
          {faqs.map((f) => (
            <div key={f.q} className="py-5">
              <h3 className="text-[15px] font-medium text-foreground">{f.q}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{f.a}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-border bg-surface">
        <div className="mx-auto w-full max-w-4xl px-6 py-16 text-center">
          <h2 className="text-[clamp(1.35rem,3vw,1.9rem)] font-semibold tracking-tight text-foreground">
            Set it up before you pay for it.
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-[15px] text-muted-foreground">
            Register your café, load your menu, print a test bill. Decide afterwards.
          </p>
          <Link href="/get-started" className="mt-7 inline-block">
            <Button size="lg">Start free</Button>
          </Link>
          <p className="mt-8 text-[13.5px] text-muted-foreground">
            Comparing options?{' '}
            <Link href="/petpooja-alternative" className="font-medium text-primary hover:underline">
              How KhaoPiyo compares to Petpooja
            </Link>
          </p>
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
