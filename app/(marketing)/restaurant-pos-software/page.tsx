import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteHeader } from '@/components/marketing/site-header'
import { SiteFooter } from '@/components/marketing/site-footer'
import { Button } from '@/components/ui/button'
import { SITE_URL, faqJsonLd, breadcrumbJsonLd, jsonLdGraph, type Faq } from '@/lib/seo'

export const metadata: Metadata = {
  title: 'Restaurant POS Software in India — Billing, QR, KDS',
  description:
    'Cloud restaurant POS software for Indian cafés and restaurants: one-screen billing, GST invoices, QR ordering, kitchen display, tables, inventory and reports. From ₹999/month.',
  keywords: [
    'restaurant POS software', 'restaurant POS software India', 'POS system for restaurants',
    'cloud POS for restaurants', 'restaurant management software', 'restaurant POS with inventory',
    'restaurant POS with QR ordering',
  ],
  alternates: { canonical: '/restaurant-pos-software' },
  openGraph: {
    title: 'Restaurant POS Software in India · KhaoPiyo',
    description:
      'Billing, GST invoicing, QR ordering, kitchen display, tables and inventory in one restaurant POS. Built and running in India.',
    url: `${SITE_URL}/restaurant-pos-software`,
    type: 'website',
  },
}

const modules = [
  {
    title: 'Billing that keeps up with the counter',
    body: 'One screen: find the item, set quantity, take payment. Held orders, split tenders, discounts within a staff member\'s limit, and a bill that runs against a table until the guest asks for it.',
    href: '/pos-billing-software',
  },
  {
    title: 'GST invoices without a second thought',
    body: 'Sequential invoice numbering, automatic CGST/SGST split, HSN/SAC per item and a GST report your accountant can reconcile at filing time. Not a paid add-on.',
    href: '/gst-billing-software-for-restaurants',
  },
  {
    title: 'QR ordering from the guest\'s own phone',
    body: 'A table QR opens the real menu — photos, sizes, add-ons, veg markers — and the order goes straight to the kitchen. No app to install, no signup beyond a name and number.',
    href: '/qr-code-ordering-system',
  },
  {
    title: 'A kitchen display that ends shouted orders',
    body: 'Every order, from the counter or a QR scan, lands on one screen in the order it arrived and moves from placed to preparing to ready. Late tickets flag themselves.',
    href: '/kitchen-display-system',
  },
  {
    title: 'Inventory that deducts itself',
    body: 'Tie a dish to its recipe and selling it moves the stock. Low-stock alerts surface before a shift runs out, and food cost per item is measured rather than estimated.',
    href: '/restaurant-inventory-management-software',
  },
  {
    title: 'A menu that is current everywhere at once',
    body: 'Change a price or mark something sold out, and the counter, the QR menu and the kitchen all see it immediately. One menu, not three that drift apart.',
    href: '/digital-menu-software',
  },
]

const faqs: Faq[] = [
  {
    q: 'What is restaurant POS software?',
    a: 'Point-of-sale software is what a restaurant bills on: it records what was ordered, prices it correctly, produces a tax invoice, and tells the kitchen what to cook. Modern systems like KhaoPiyo extend that into tables, QR ordering, inventory, reporting and customer loyalty, so the same order flows through the whole operation instead of being re-keyed.',
  },
  {
    q: 'Do I need to buy a POS machine or terminal?',
    a: 'No. KhaoPiyo runs in a web browser on a computer, laptop or tablet you already own. A thermal printer is optional — the kitchen display works without one.',
  },
  {
    q: 'How much does restaurant POS software cost in India?',
    a: 'KhaoPiyo publishes three plans — ₹999, ₹2,499 and ₹4,999 per month — with no setup fee and no commission on your sales. Prices across the market vary widely, and many vendors quote per outlet after a sales call rather than publishing anything.',
  },
  {
    q: 'Does it work for both a café and a full restaurant?',
    a: 'Yes. Dine-in and takeaway are independent settings, so a takeaway counter can run with tables switched off entirely, while a full-service restaurant uses the floor view, table sessions and bills that stay open until requested.',
  },
  {
    q: 'Can I move my existing menu across?',
    a: 'Yes — menus import from Excel or CSV, including categories, sizes with their own prices, add-ons and per-item cost, so a 150-item menu does not have to be typed in by hand.',
  },
  {
    q: 'Is my data safe if my computer breaks?',
    a: 'Your data lives on the server, not on the till. A broken computer means signing in on another one; bills, menu and reports are unaffected. The trade-off is that billing needs a working internet connection.',
  },
]

const cities = [
  { slug: 'hisar', name: 'Hisar' },
  { slug: 'gurugram', name: 'Gurugram' },
  { slug: 'noida', name: 'Noida' },
  { slug: 'pune', name: 'Pune' },
  { slug: 'bangalore-hsr-layout', name: 'HSR Layout, Bengaluru' },
]

export default function RestaurantPosSoftwarePage() {
  return (
    <div className="min-h-dvh bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdGraph(
            faqJsonLd(faqs),
            breadcrumbJsonLd([{ name: 'Restaurant POS software', path: '/restaurant-pos-software' }]),
          ),
        }}
      />
      <SiteHeader />

      <section className="mx-auto w-full max-w-3xl px-6 pt-20 pb-10">
        <p className="text-[13px] font-medium uppercase tracking-wide text-primary">Restaurant POS</p>
        <h1 className="mt-3 font-display text-[clamp(2rem,5vw,3rem)] font-semibold tracking-tight text-foreground">
          One system for the whole restaurant, not five that argue.
        </h1>
        <p className="mt-6 text-[16.5px] leading-relaxed text-muted-foreground">
          KhaoPiyo is cloud restaurant POS software for Indian cafés and restaurants. Billing, GST
          invoicing, QR ordering, the kitchen display, tables, menu, inventory, reports and loyalty
          run off one order and one menu — so nothing has to be typed in twice, and nothing
          disagrees at the end of the day.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/get-started"><Button size="lg">Start free</Button></Link>
          <Link href="/pricing"><Button size="lg" variant="secondary">See pricing</Button></Link>
        </div>
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto w-full max-w-6xl px-6 py-20">
          <h2 className="max-w-xl text-[clamp(1.75rem,4vw,2.5rem)] font-semibold tracking-tight text-foreground">
            What the platform actually covers
          </h2>
          <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {modules.map((m) => (
              <Link key={m.title} href={m.href} className="group bg-surface p-6 hover:bg-background">
                <h3 className="text-base font-medium text-foreground group-hover:text-primary">{m.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{m.body}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-3xl px-6 py-16">
        <h2 className="text-[clamp(1.5rem,3.5vw,2rem)] font-semibold tracking-tight text-foreground">
          Running live, not just in a demo
        </h2>
        <p className="mt-4 text-[15.5px] leading-relaxed text-muted-foreground">
          KhaoPiyo&apos;s first café is <strong className="font-medium text-foreground">Brewora Café
          in Hisar, Haryana</strong>, where the billing engine, kitchen display and inventory run in
          daily service. It is built by <a href="https://ventron.in" rel="noopener" className="font-medium text-primary hover:underline">Ventron</a>,
          and we would rather point at one real café than a wall of logos we do not have.
        </p>
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto w-full max-w-3xl px-6 py-16">
          <h2 className="text-[clamp(1.5rem,3.5vw,2rem)] font-semibold tracking-tight text-foreground">
            Where cafés are running it
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
            Cloud software works anywhere in India, but what a café has to deal with is local. These
            pages cover what running a place in each market is actually like.
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {cities.map((c) => (
              <Link
                key={c.slug}
                href={`/restaurant-pos-software/${c.slug}`}
                className="rounded-xl border border-border bg-background p-5 hover:border-border-strong"
              >
                <p className="text-sm font-medium text-foreground">Restaurant POS software in {c.name}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-3xl px-6 py-16">
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
