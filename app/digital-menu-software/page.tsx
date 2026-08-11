import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { SiteHeader } from '@/components/marketing/site-header'
import { SiteFooter } from '@/components/marketing/site-footer'
import { breadcrumbJsonLd, jsonLdGraph } from '@/lib/seo'

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://khaopiyo.ventron.in'

export const metadata: Metadata = {
  title: 'Digital Menu Software for Cafés and Restaurants',
  description:
    'One digital menu, always current — sold-out updates everywhere at once, bulk import, size variants and add-ons, with cart-based recommendations built in.',
  keywords: [
    'digital menu software', 'digital menu for restaurants', 'online menu software cafe',
    'QR digital menu', 'menu management software India', 'restaurant menu software',
  ],
  alternates: { canonical: '/digital-menu-software' },
  openGraph: {
    title: 'Digital Menu Software for Cafés and Restaurants · KhaoPiyo',
    description:
      'A digital menu that stays current everywhere — sold-out syncs instantly, bulk import from a spreadsheet, size variants, add-ons and cart recommendations.',
    url: `${siteUrl}/digital-menu-software`,
    type: 'website',
  },
}

const features = [
  {
    title: 'One menu, everywhere at once',
    body: 'The counter POS, QR ordering, and the kitchen all read the same menu. Change a price or mark an item sold out, and every surface reflects it immediately — no separate "online menu" quietly falling out of date.',
  },
  {
    title: 'Bulk import from a spreadsheet',
    body: 'Bring your existing menu in as a spreadsheet — categories, items, prices, and Small/Medium/Large size columns — instead of typing every item in one at a time.',
  },
  {
    title: 'Sizes and add-ons, priced separately',
    body: 'A Small, Medium and Large of the same item can have their own price and their own cost, and add-ons layer on top — the menu reflects how the dish is actually sold, not a single flat price.',
  },
  {
    title: 'Sold out means sold out',
    body: "Mark an item out of stock from the dashboard and it's disabled at the counter, on the QR menu, and in the kitchen at the same moment — a guest never orders something that isn't available.",
  },
  {
    title: 'Recommendations that fit the cart',
    body: "A main course gets offered a side or a drink, never another main — ranked off your own sales history and any rules you set, with a keyword-based fallback so even a brand-new menu suggests something sensible on day one.",
  },
  {
    title: 'Fast to load, even on weak Wi-Fi',
    body: 'Menu images load lazily and the menu itself is cached server-side, so browsing stays quick for a guest on a patchy café connection instead of stalling on a slow image-heavy page.',
  },
]

const faqs = [
  {
    q: 'What is digital menu software?',
    a: 'It\'s software where you manage your café\'s menu once, from a dashboard, and it stays current everywhere it\'s shown — the counter till, QR ordering, and the kitchen — instead of a paper menu, a PDF, and a separate ordering app slowly drifting out of sync with each other.',
  },
  {
    q: 'If I mark an item sold out, does it update on the QR menu too?',
    a: 'Yes — sold-out status is shared across the counter POS, the QR ordering menu, and the kitchen display at once. There\'s no separate step to hide it from online ordering.',
  },
  {
    q: 'Can I import my whole menu instead of typing it in?',
    a: 'Yes — bulk import from a spreadsheet, including Small/Medium/Large size columns and per-size cost, rather than adding every item and variant by hand.',
  },
  {
    q: 'Does the digital menu support item variants like size and add-ons?',
    a: 'Yes. Each size variant can have its own price and cost, and items can carry add-ons — the menu mirrors how the item is actually priced and sold.',
  },
  {
    q: 'Does the menu suggest items to customers, or just list them?',
    a: 'It can suggest relevant add-ons based on what\'s already in the cart — a hot drink offered a dessert, a main offered a side — ranked from real sales history and any rules you set, never a random upsell.',
  },
  {
    q: 'Is the digital menu only usable through QR ordering?',
    a: 'No — it\'s the same menu whether an order is placed at the counter, by a waiter tableside, or by a guest scanning a QR code. One menu, one source of truth, regardless of how the order comes in.',
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

export default function DigitalMenuSoftwarePage() {
  return (
    <div className="flex w-full min-h-dvh flex-col bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdGraph(
            faqJsonLd,
            breadcrumbJsonLd([{ name: "Digital menu software", path: '/digital-menu-software' }]),
          ),
        }}
      />
      <SiteHeader />

      <section className="mx-auto w-full max-w-4xl px-6 py-16 md:py-24">
        <span className="inline-flex items-center rounded-full border border-border bg-surface px-3 py-1 text-[12px] font-medium text-muted-foreground">
          Digital menu
        </span>
        <h1 className="mt-5 max-w-2xl text-[clamp(2rem,5vw,3.25rem)] font-semibold leading-[1.08] tracking-tight text-foreground">
          One menu. Always current, everywhere it&apos;s shown.
        </h1>
        <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-muted-foreground">
          Manage your menu once from the dashboard. The counter, the QR menu, and the kitchen all
          read the same data — so a price change or a sold-out item is correct everywhere the
          moment you save it.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/get-started">
            <Button size="lg">Start free</Button>
          </Link>
          <Link href="/qr-code-ordering-system">
            <Button variant="secondary" size="lg">See QR ordering</Button>
          </Link>
        </div>
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto w-full max-w-6xl px-6 py-20">
          <h2 className="max-w-xl text-[clamp(1.75rem,4vw,2.5rem)] font-semibold tracking-tight text-foreground">
            Built to be edited daily, not set once and forgotten.
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
          Haryana</strong> — the same menu guests browse on QR ordering is the one staff bill from at the
          counter, every day.
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
            <Link href="/pos-billing-software" className="rounded-xl border border-border bg-background p-5 hover:border-border-strong">
              <p className="text-sm font-medium text-foreground">POS &amp; billing software</p>
              <p className="mt-1 text-[13px] text-muted-foreground">The full platform, end to end.</p>
            </Link>
            <Link href="/restaurant-inventory-management-software" className="rounded-xl border border-border bg-background p-5 hover:border-border-strong">
              <p className="text-sm font-medium text-foreground">Inventory management</p>
              <p className="mt-1 text-[13px] text-muted-foreground">Recipes, stock, food costing.</p>
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
