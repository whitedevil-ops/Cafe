import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { SiteHeader } from '@/components/marketing/site-header'
import { SiteFooter } from '@/components/marketing/site-footer'

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://khaopiyo.ventron.in'

export const metadata: Metadata = {
  title: 'GST Billing Software for Restaurants & Cafés',
  description:
    'Every bill settles into a proper GST tax invoice — sequential invoice numbering, automatic CGST/SGST split, HSN/SAC codes per item, and place of supply, generated the moment an order is paid.',
  keywords: [
    'GST billing software for restaurants', 'GST invoice software cafe',
    'restaurant GST compliance software', 'CGST SGST billing software',
    'HSN SAC restaurant billing', 'GST invoice numbering software',
    'tax invoice software for cafes India',
  ],
  alternates: { canonical: '/gst-billing-software-for-restaurants' },
  openGraph: {
    title: 'GST Billing Software for Restaurants & Cafés · KhaoPiyo',
    description:
      'Sequential GST invoice numbering, automatic CGST/SGST split, HSN/SAC per item, and place of supply — generated the moment an order settles, not reconstructed later.',
    url: `${siteUrl}/gst-billing-software-for-restaurants`,
    type: 'website',
  },
}

const features = [
  {
    title: 'Sequential invoice numbering',
    body: 'Registered cafés get a proper financial-year invoice sequence (PREFIX/26-27/00001), assigned the moment an order is paid — not backfilled at month-end.',
  },
  {
    title: 'CGST/SGST split, automatically',
    body: 'Tax splits into CGST and SGST on every applicable bill without anyone doing the arithmetic by hand.',
  },
  {
    title: 'HSN/SAC per item',
    body: 'Every line item carries its HSN/SAC code on the invoice — set a sensible default for the café, and override it per item where it genuinely differs.',
  },
  {
    title: 'Tax-inclusive or exclusive pricing',
    body: 'Price your menu the way your café actually prices it — GST shown included in the displayed price, or added on top — and the invoice reflects it correctly either way.',
  },
  {
    title: 'Place of supply, on the bill',
    body: 'The invoice carries the café\'s state and state code as place of supply, exactly where a tax invoice needs it.',
  },
  {
    title: 'A digital invoice for every order',
    body: 'Every settled order gets a permanent digital tax invoice the customer can view or download as a PDF — nothing is reconstructed after the fact from a report.',
  },
]

const faqs = [
  {
    q: 'What is GST billing software for a restaurant or café?',
    a: 'It\'s billing software that generates a proper GST tax invoice for every order — with the correct CGST/SGST split, HSN/SAC codes, and a compliant invoice number — instead of a plain bill with tax added as an afterthought.',
  },
  {
    q: 'Is KhaoPiyo GST-compliant billing software?',
    a: 'Yes. A GST-registered café gets sequential financial-year invoice numbers, an automatic CGST/SGST split, HSN/SAC codes per item, and a place-of-supply field — generated the instant an order settles.',
  },
  {
    q: 'Do I need to be GST-registered to use KhaoPiyo?',
    a: 'No. A café that isn\'t GST-registered can bill normally without any of the tax-invoice fields; GST invoicing only activates once you mark the café as registered and enter a GSTIN.',
  },
  {
    q: 'Does it handle tax-inclusive pricing?',
    a: 'Yes — a café can price its menu as GST-inclusive or GST-exclusive, and the invoice\'s tax breakdown is computed correctly either way.',
  },
  {
    q: 'Can each menu item have its own HSN/SAC code?',
    a: 'Yes. Set one default HSN/SAC for the café (996331 for restaurant services is the common default) and override it on individual items where a different code genuinely applies.',
  },
  {
    q: 'How does a customer get their GST invoice?',
    a: 'Every settled order has a permanent digital receipt page with the full tax invoice, which the customer can view in their browser or download as a PDF.',
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

export default function GstBillingPage() {
  return (
    <div className="flex w-full min-h-dvh flex-col bg-background">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <SiteHeader />

      <section className="mx-auto w-full max-w-4xl px-6 py-16 md:py-24">
        <span className="inline-flex items-center rounded-full border border-border bg-surface px-3 py-1 text-[12px] font-medium text-muted-foreground">
          GST invoicing
        </span>
        <h1 className="mt-5 max-w-2xl text-[clamp(2rem,5vw,3.25rem)] font-semibold leading-[1.08] tracking-tight text-foreground">
          A GST-correct tax invoice on every single bill.
        </h1>
        <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-muted-foreground">
          Sequential invoice numbering, automatic CGST/SGST split, HSN/SAC codes per item, and
          place of supply — generated the moment an order settles, not reconstructed at month-end
          from a spreadsheet.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/get-started">
            <Button size="lg">Start free</Button>
          </Link>
          <Link href="/pos-billing-software">
            <Button variant="secondary" size="lg">See the full POS platform</Button>
          </Link>
        </div>
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto w-full max-w-6xl px-6 py-20">
          <h2 className="max-w-xl text-[clamp(1.75rem,4vw,2.5rem)] font-semibold tracking-tight text-foreground">
            Compliant by default, not bolted on.
          </h2>
          <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
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
          Haryana</strong> — real GST invoices issued on real bills, every day.
        </p>
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

      <SiteFooter />
    </div>
  )
}
