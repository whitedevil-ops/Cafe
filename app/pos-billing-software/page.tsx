import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { SiteHeader } from '@/components/marketing/site-header'
import { SiteFooter } from '@/components/marketing/site-footer'
import { breadcrumbJsonLd, jsonLdGraph } from '@/lib/seo'

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://khaopiyo.ventron.in'

export const metadata: Metadata = {
  title: 'POS & Billing Software for Cafés and Restaurants',
  description:
    'A cloud POS SaaS for cafés and restaurants — instant GST-compliant bills, QR ordering, CGST/SGST invoices, inventory and staff roles on a monthly subscription.',
  keywords: [
    'POS SaaS', 'restaurant POS SaaS', 'POS billing software', 'billing SaaS India',
    'cafe billing software', 'GST billing software', 'cloud POS subscription',
  ],
  alternates: { canonical: '/pos-billing-software' },
  openGraph: {
    title: 'POS & Billing Software for Cafés and Restaurants · KhaoPiyo',
    description:
      'A cloud POS SaaS — GST-compliant billing, QR ordering, inventory and staff management for cafés and restaurants on a monthly subscription, no hardware lock-in.',
    url: `${siteUrl}/pos-billing-software`,
    type: 'website',
  },
}

const billingFeatures = [
  {
    title: 'Instant, GST-correct bills',
    body: 'Every order settles into a proper tax invoice — CGST/SGST split automatically, HSN/SAC codes per item, sequential invoice numbering. No spreadsheet math, no manual GST correction at month-end.',
  },
  {
    title: 'Split payments, no fuss',
    body: 'Cash, card, UPI, wallet — split across methods on the same bill. Payment status is derived from what actually got paid, not a checkbox someone forgot to tick.',
  },
  {
    title: 'QR ordering from the table',
    body: 'Guests scan, order, and pay from their phone — no app install. Orders land straight in the kitchen; the bill is ready before they ask for it.',
  },
  {
    title: 'Inventory that deducts itself',
    body: 'Recipes tied to stock, so a sold item quietly deducts its ingredients. Low-stock alerts before you run out, not after.',
  },
  {
    title: 'Role-based staff access',
    body: 'Owners, managers, cashiers, waiters — each sees only the screens their role needs. No shared logins, no guessing who closed which bill.',
  },
  {
    title: 'Real numbers, daily',
    body: "Today's sales, average order value, peak hours, best sellers — the numbers an owner actually checks, without exporting a report first.",
  },
]

const faqs = [
  {
    q: 'What is POS billing software for a café or restaurant?',
    a: 'POS (point of sale) billing software is what a café or restaurant uses to take orders, generate the customer bill, apply the correct GST, and record the payment — replacing a manual bill book or a spreadsheet with something that\'s accurate and instant.',
  },
  {
    q: 'Is KhaoPiyo GST-compliant billing software?',
    a: 'Yes. Registered cafés get sequential GST invoice numbers with an automatic CGST/SGST split, HSN/SAC codes per item, and a place-of-supply field on every bill — generated the moment an order settles, not reconstructed later.',
  },
  {
    q: 'Do I need special billing hardware?',
    a: 'No. KhaoPiyo runs in a browser on any laptop, tablet, or phone. You can add a receipt printer if you want a physical copy, but it isn\'t required to start billing.',
  },
  {
    q: 'Can customers pay and get their bill without asking a waiter?',
    a: 'Yes — QR ordering lets a guest browse the menu, order, and pay from their own phone, and download their own bill as a PDF once it\'s settled.',
  },
  {
    q: 'Is there café billing software built for cafés in Hisar or smaller Indian cities?',
    a: 'KhaoPiyo\'s first live café is Brewora Café in Hisar, Haryana — running real day-to-day billing, QR ordering, and GST invoicing, not a demo.',
  },
  {
    q: 'Is KhaoPiyo a SaaS product, or do I own the software?',
    a: 'KhaoPiyo is a cloud POS SaaS — you subscribe monthly (₹999–₹4,999) instead of buying software or hardware outright. Updates, hosting and backups are handled for you; cancel anytime.',
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

export default function PosBillingSoftwarePage() {
  return (
    <div className="flex w-full min-h-dvh flex-col bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdGraph(
            faqJsonLd,
            breadcrumbJsonLd([{ name: "POS & billing software", path: '/pos-billing-software' }]),
          ),
        }}
      />
      <SiteHeader />

      <section className="mx-auto w-full max-w-4xl px-6 py-16 md:py-24">
        <span className="inline-flex items-center rounded-full border border-border bg-surface px-3 py-1 text-[12px] font-medium text-muted-foreground">
          POS &amp; billing software
        </span>
        <h1 className="mt-5 max-w-2xl text-[clamp(2rem,5vw,3.25rem)] font-semibold leading-[1.08] tracking-tight text-foreground">
          Billing software built for how Indian cafés actually run.
        </h1>
        <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-muted-foreground">
          A cloud POS SaaS you subscribe to, not hardware you buy. Instant, GST-correct food
          bills. QR ordering from the table. Inventory that tracks itself. One platform instead
          of a bill book, a spreadsheet, and a separate ordering app.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/get-started">
            <Button size="lg">Start free</Button>
          </Link>
          <Link href="/petpooja-alternative">
            <Button variant="secondary" size="lg">Comparing to Petpooja?</Button>
          </Link>
        </div>
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto w-full max-w-6xl px-6 py-20">
          <h2 className="max-w-xl text-[clamp(1.75rem,4vw,2.5rem)] font-semibold tracking-tight text-foreground">
            Everything a modern billing counter needs.
          </h2>
          <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {billingFeatures.map((f) => (
              <div key={f.title} className="bg-surface p-6">
                <h3 className="text-base font-medium text-foreground">{f.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-4xl px-6 py-20">
        <h2 className="text-[clamp(1.5rem,3.5vw,2rem)] font-semibold tracking-tight text-foreground">
          Running live, not just in a demo.
        </h2>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
          KhaoPiyo&apos;s first café is <strong className="font-medium text-foreground">Brewora Café in Hisar,
          Haryana</strong> — real orders, real GST bills, real QR menus, every day. If you run a café or
          restaurant in Hisar (or anywhere else in India) looking for billing software that&apos;s
          actually in production, this is it.
        </p>
      </section>

      <section id="pricing" className="border-y border-border bg-surface">
        <div className="mx-auto w-full max-w-4xl px-6 py-20 text-center">
          <h2 className="text-[clamp(1.75rem,4vw,2.5rem)] font-semibold tracking-tight text-foreground">
            Simple pricing, no hardware to buy.
          </h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {[
              ['Starter', '₹999', 'per month — billing, QR ordering, up to 3 staff'],
              ['Growth', '₹2,499', 'per month — loyalty, coupons, online payments, up to 8 staff'],
              ['Scale', '₹4,999', 'per month — multi-outlet, inventory, no staff cap'],
            ].map(([name, price, desc]) => (
              <div key={name} className="rounded-xl border border-border bg-background p-6 text-left">
                <p className="text-sm font-medium text-foreground">{name}</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{price}<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
                <p className="mt-2 text-[13px] text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-8">
            <Link href="/get-started">
              <Button size="lg">Start free</Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-3xl px-6 py-20">
        <h2 className="text-[clamp(1.5rem,3.5vw,2rem)] font-semibold tracking-tight text-foreground">
          Frequently asked questions
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
        <div className="mx-auto w-full max-w-4xl px-6 py-16">
          <h2 className="text-[clamp(1.25rem,3vw,1.75rem)] font-semibold tracking-tight text-foreground">
            Go deeper on a specific module
          </h2>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <Link href="/qr-code-ordering-system" className="rounded-xl border border-border bg-background p-5 hover:border-border-strong">
              <p className="text-sm font-medium text-foreground">QR ordering system</p>
              <p className="mt-1 text-[13px] text-muted-foreground">Scan, order, pay from the table.</p>
            </Link>
            <Link href="/restaurant-inventory-management-software" className="rounded-xl border border-border bg-background p-5 hover:border-border-strong">
              <p className="text-sm font-medium text-foreground">Inventory management</p>
              <p className="mt-1 text-[13px] text-muted-foreground">Recipes, stock, food costing.</p>
            </Link>
            <Link href="/gst-billing-software-for-restaurants" className="rounded-xl border border-border bg-background p-5 hover:border-border-strong">
              <p className="text-sm font-medium text-foreground">GST billing software</p>
              <p className="mt-1 text-[13px] text-muted-foreground">Compliant tax invoices, every bill.</p>
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
