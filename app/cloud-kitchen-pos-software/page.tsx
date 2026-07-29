import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { SiteHeader } from '@/components/marketing/site-header'
import { SiteFooter } from '@/components/marketing/site-footer'

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://khaopiyo.ventron.in'

export const metadata: Metadata = {
  title: 'Cloud Kitchen POS Software — Billing & Kitchen Display',
  description:
    'POS billing, kitchen display, GST invoicing and recipe-based food costing for takeaway and delivery-only kitchens — no dine-in or table setup required.',
  keywords: [
    'cloud kitchen POS', 'cloud kitchen billing software', 'ghost kitchen POS software',
    'dark kitchen software India', 'takeaway billing software', 'delivery kitchen POS',
  ],
  alternates: { canonical: '/cloud-kitchen-pos-software' },
  openGraph: {
    title: 'Cloud Kitchen POS Software — Billing & Kitchen Display · KhaoPiyo',
    description:
      'Cloud kitchen POS: counter billing, one kitchen display queue, GST-correct invoices and per-dish food costing for takeaway and delivery-only operations.',
    url: `${siteUrl}/cloud-kitchen-pos-software`,
    type: 'website',
  },
}

const features = [
  {
    title: 'Takeaway-first, dine-in optional',
    body: 'Dine-in and takeaway are independent settings, not a package deal — a kitchen with no dining room can run counter billing and pickup ordering with table management switched off entirely.',
  },
  {
    title: 'One kitchen display, one queue',
    body: 'Every order — counter-billed or placed through QR ordering for pickup — lands on the same kitchen display as it comes in, moving from placed to preparing to ready without anyone re-keying it by hand.',
  },
  {
    title: 'GST-correct on every order',
    body: 'Sequential invoice numbering, automatic CGST/SGST split, and HSN/SAC codes per item — the same tax-correct billing a dine-in café gets, generated the moment an order settles.',
  },
  {
    title: 'Real food cost per dish',
    body: "Thin margins make food cost visibility matter more, not less. Recipes tie each dish to its actual ingredient cost, including per-size costing when portions genuinely differ.",
  },
  {
    title: 'Stock that deducts itself',
    body: "A sold item quietly deducts its recipe's ingredients from stock, and low-stock alerts surface on the dashboard before a shift runs out mid-service.",
  },
  {
    title: 'Staff roles, not shared logins',
    body: 'Cooks, counter staff, and managers each get access scoped to what their role needs — useful the moment a single-kitchen operation adds a second or third person.',
  },
]

const faqs = [
  {
    q: 'What is cloud kitchen POS software?',
    a: 'It\'s billing and order-management software built for a delivery-only or takeaway-only kitchen — taking orders, generating a correct bill and GST invoice, and running the kitchen queue — without requiring the table and dine-in setup a sit-down restaurant would use.',
  },
  {
    q: 'Do I have to set up tables or dine-in to use it for a cloud kitchen?',
    a: 'No. Dine-in and takeaway are separate settings on the café profile. A cloud kitchen can run counter billing and QR ordering for pickup with dine-in and table management left off entirely.',
  },
  {
    q: 'Does it integrate with Swiggy, Zomato, or other delivery aggregators?',
    a: 'Not today. KhaoPiyo handles orders placed directly — at the counter or through its own QR ordering for pickup — and doesn\'t currently ingest orders from third-party delivery aggregators. We\'d rather say that plainly than imply support that isn\'t there yet.',
  },
  {
    q: 'Can a cloud kitchen track food cost per dish?',
    a: 'Yes — recipe-based costing works the same way it does for a dine-in café: tie a dish to the ingredients and quantities it actually uses, and get its real cost, including per-size variants.',
  },
  {
    q: 'Does the kitchen display work differently for a cloud kitchen?',
    a: 'No — it\'s the same kitchen display and order engine used across KhaoPiyo. Every order, from wherever it was placed, shows up the same way and moves through the same statuses.',
  },
  {
    q: 'Is this only for restaurants with a dining room, or does it fit a single dark kitchen?',
    a: 'It fits either. Dine-in, tables, and QR-at-the-table ordering are optional modules — a single dark or ghost kitchen can run on billing, kitchen display, inventory, and GST invoicing alone.',
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

export default function CloudKitchenPosPage() {
  return (
    <div className="flex w-full min-h-dvh flex-col bg-background">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <SiteHeader />

      <section className="mx-auto w-full max-w-4xl px-6 py-16 md:py-24">
        <span className="inline-flex items-center rounded-full border border-border bg-surface px-3 py-1 text-[12px] font-medium text-muted-foreground">
          Cloud kitchen &amp; takeaway
        </span>
        <h1 className="mt-5 max-w-2xl text-[clamp(2rem,5vw,3.25rem)] font-semibold leading-[1.08] tracking-tight text-foreground">
          POS built for a kitchen with no dining room.
        </h1>
        <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-muted-foreground">
          Counter billing, one kitchen display, GST-correct invoices, and recipe-based food
          costing — without any dine-in or table setup forced on you. Turn on what a
          takeaway or delivery-only kitchen actually needs, and leave the rest off.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/signup">
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
            Everything a takeaway-only kitchen needs, nothing it has to switch on.
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
          Haryana</strong> — the same billing, kitchen display, and inventory engine a takeaway-only
          kitchen would run on, in production every day.
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
            <Link href="/restaurant-inventory-management-software" className="rounded-xl border border-border bg-background p-5 hover:border-border-strong">
              <p className="text-sm font-medium text-foreground">Inventory management</p>
              <p className="mt-1 text-[13px] text-muted-foreground">Recipes, stock, food costing.</p>
            </Link>
            <Link href="/gst-billing-software-for-restaurants" className="rounded-xl border border-border bg-background p-5 hover:border-border-strong">
              <p className="text-sm font-medium text-foreground">GST billing software</p>
              <p className="mt-1 text-[13px] text-muted-foreground">Compliant tax invoices, every bill.</p>
            </Link>
            <Link href="/pos-billing-software" className="rounded-xl border border-border bg-background p-5 hover:border-border-strong">
              <p className="text-sm font-medium text-foreground">POS &amp; billing software</p>
              <p className="mt-1 text-[13px] text-muted-foreground">The full platform, end to end.</p>
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
