import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { SiteHeader } from '@/components/marketing/site-header'
import { SiteFooter } from '@/components/marketing/site-footer'
import { breadcrumbJsonLd, jsonLdGraph } from '@/lib/seo'

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://khaopiyo.ventron.in'

export const metadata: Metadata = {
  title: 'QR Code Ordering System for Restaurants & Cafés',
  description:
    'Let guests scan, order, and pay from their own phone — no app to install. Orders land straight in the kitchen, with live order status, smart recommendations, and offline resilience built in.',
  keywords: [
    'QR code ordering system', 'QR menu ordering software', 'restaurant QR ordering',
    'contactless ordering system India', 'scan to order', 'digital menu QR code',
    'table QR ordering', 'cafe QR ordering system',
  ],
  alternates: { canonical: '/qr-code-ordering-system' },
  openGraph: {
    title: 'QR Code Ordering System for Restaurants & Cafés · KhaoPiyo',
    description:
      'Scan, order, and pay from the table — no app install. Live order status, smart cross-sell recommendations, and offline resilience, wired straight into the kitchen.',
    url: `${siteUrl}/qr-code-ordering-system`,
    type: 'website',
  },
}

const features = [
  {
    title: 'No app, no friction',
    body: 'A guest scans the table QR code and is on the menu in one tap — nothing to download, nothing to sign up for beyond a name and phone number.',
  },
  {
    title: 'Straight into the kitchen',
    body: "An order placed at the table is the same order the kitchen sees on the KDS — no re-keying, no phone call to the counter, no lag between \"placed\" and \"the kitchen knows.\"",
  },
  {
    title: 'Live status, not silence',
    body: 'Guests see their order move from placed to preparing to ready right on their phone, so nobody\'s wondering whether it went through.',
  },
  {
    title: 'Suggestions that fit the cart',
    body: "A main course gets offered a side or a drink, a hot drink gets offered dessert — never another main. It's ranked off owner rules and real sales history first, with a sensible keyword-based fallback so a brand-new menu still gets relevant suggestions on day one.",
  },
  {
    title: 'Pay from the table, or at the counter',
    body: 'Guests can pay online the moment they\'re done, or choose pay-at-counter — the bill and its GST invoice are correct either way.',
  },
  {
    title: 'Keeps working on a bad connection',
    body: 'A patchy café Wi-Fi doesn\'t take ordering down — the menu and an in-flight order recover gracefully instead of showing a blank screen.',
  },
]

const faqs = [
  {
    q: 'What is a QR code ordering system?',
    a: 'It\'s a menu a customer opens by scanning a QR code at their table, then orders and (optionally) pays from directly — instead of waiting to flag down a waiter or being handed a physical menu.',
  },
  {
    q: 'Does the customer need to install an app?',
    a: 'No. The menu opens in their phone\'s browser. They enter a name and phone number once per café, and that\'s the only "login" involved.',
  },
  {
    q: 'Does QR ordering work for takeaway too, not just dine-in?',
    a: 'Yes — the same ordering flow supports both dine-in (tied to a table) and takeaway.',
  },
  {
    q: 'Is the order really live in the kitchen, or does staff still re-enter it?',
    a: 'It\'s the same order end to end. A QR order, a counter POS order, and a waiter\'s tableside order all run through one order engine, so the kitchen display shows all three the same way — nothing gets manually re-typed.',
  },
  {
    q: 'What happens if a café\'s Wi-Fi drops mid-order?',
    a: 'The menu and an order already in progress are built to survive a dropped connection rather than fail outright — the customer isn\'t left staring at an error with a half-placed order.',
  },
  {
    q: 'Can I turn QR ordering off if I only want counter billing?',
    a: 'Yes — QR ordering is one of several optional modules. A café can run counter POS only, dine-in only, takeaway only, or any combination.',
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

export default function QrOrderingPage() {
  return (
    <div className="flex w-full min-h-dvh flex-col bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdGraph(
            faqJsonLd,
            breadcrumbJsonLd([{ name: "QR ordering system", path: '/qr-code-ordering-system' }]),
          ),
        }}
      />
      <SiteHeader />

      <section className="mx-auto w-full max-w-4xl px-6 py-16 md:py-24">
        <span className="inline-flex items-center rounded-full border border-border bg-surface px-3 py-1 text-[12px] font-medium text-muted-foreground">
          QR code ordering
        </span>
        <h1 className="mt-5 max-w-2xl text-[clamp(2rem,5vw,3.25rem)] font-semibold leading-[1.08] tracking-tight text-foreground">
          A QR ordering system guests actually use.
        </h1>
        <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-muted-foreground">
          Scan, order, pay — no app install, no waiting to flag a waiter. The order lands straight
          in the kitchen and stays live on the guest&apos;s phone until it&apos;s served.
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
            Built to be used at a busy table, not just a demo.
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
          Haryana</strong> — real guests scanning, ordering, and paying from the table every day.
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
