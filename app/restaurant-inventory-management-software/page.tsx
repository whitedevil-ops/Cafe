import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { SiteHeader } from '@/components/marketing/site-header'
import { SiteFooter } from '@/components/marketing/site-footer'
import { breadcrumbJsonLd, jsonLdGraph } from '@/lib/seo'

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://khaopiyo.ventron.in'

export const metadata: Metadata = {
  title: 'Restaurant & Café Inventory Management Software',
  description:
    'Inventory tied to your recipes, not a separate spreadsheet — a sold item deducts its own ingredients, low-stock alerts fire before you run out, and purchase orders receive straight into stock.',
  keywords: [
    'restaurant inventory management software', 'cafe inventory software',
    'recipe costing software India', 'food cost management software',
    'restaurant stock management software', 'purchase order software for restaurants',
    'low stock alerts restaurant',
  ],
  alternates: { canonical: '/restaurant-inventory-management-software' },
  openGraph: {
    title: 'Restaurant & Café Inventory Management Software · KhaoPiyo',
    description:
      'Recipe-linked stock deduction, low-stock alerts, purchase orders and per-item food costing — inventory that updates itself when a bill is cut.',
    url: `${siteUrl}/restaurant-inventory-management-software`,
    type: 'website',
  },
}

const features = [
  {
    title: 'Recipes drive the stock count',
    body: 'Tie a menu item to the ingredients its recipe actually uses, and every sale quietly deducts the right quantities — no separate stock-take to reconcile against sales at month-end.',
  },
  {
    title: 'Low-stock alerts, not surprises',
    body: 'See what\'s running low on the owner dashboard before the kitchen finds out mid-service, not after a guest is told an item is unavailable.',
  },
  {
    title: 'Real per-item food cost',
    body: 'Know what a dish actually costs to make, ingredient by ingredient — including per-size costing when a Small, Medium and Large variant genuinely cost different amounts to prepare.',
  },
  {
    title: 'Suppliers and purchase orders',
    body: 'Track who you buy from, raise a purchase order, and receive it straight into stock — one record of what was ordered, from whom, and what actually arrived.',
  },
  {
    title: 'Stock reverses on cancellation',
    body: 'Cancel an order and the ingredients it would have deducted go back into stock automatically — no manual correction to remember.',
  },
  {
    title: 'Optional, not forced',
    body: "A café that doesn't want to track ingredient-level stock yet can skip it entirely and turn it on later — it's a module, not a requirement to start billing.",
  },
]

const faqs = [
  {
    q: 'What is restaurant inventory management software?',
    a: 'It\'s software that tracks what ingredients and stock a café or restaurant has on hand, and reduces that stock automatically as items sell — instead of a manual stock register kept separately from billing.',
  },
  {
    q: 'Does it track recipes, or just raw stock counts?',
    a: 'Recipes. A menu item is linked to the specific ingredients and quantities its recipe uses, so selling that item deducts the right amount of each ingredient, not just "one unit of the dish."',
  },
  {
    q: 'Can it tell me the real cost of a dish?',
    a: 'Yes — food costing is computed from the recipe\'s actual ingredient costs, including separately for Small/Medium/Large size variants where the ingredient quantities genuinely differ.',
  },
  {
    q: 'Does it handle suppliers and purchase orders?',
    a: 'Yes — you can add suppliers, raise purchase orders against them, and receive stock straight into inventory when it arrives.',
  },
  {
    q: 'What happens to stock if an order gets cancelled?',
    a: 'The ingredients that order would have deducted are reversed back into stock automatically, so a cancellation never silently understates what you actually have on hand.',
  },
  {
    q: 'Do I have to use inventory tracking from day one?',
    a: 'No — it\'s an optional module. Plenty of cafés start with just billing and QR ordering, and turn inventory on once they\'re ready to track ingredient-level stock.',
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

export default function InventorySoftwarePage() {
  return (
    <div className="flex w-full min-h-dvh flex-col bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdGraph(
            faqJsonLd,
            breadcrumbJsonLd([{ name: "Inventory management", path: '/restaurant-inventory-management-software' }]),
          ),
        }}
      />
      <SiteHeader />

      <section className="mx-auto w-full max-w-4xl px-6 py-16 md:py-24">
        <span className="inline-flex items-center rounded-full border border-border bg-surface px-3 py-1 text-[12px] font-medium text-muted-foreground">
          Inventory &amp; food costing
        </span>
        <h1 className="mt-5 max-w-2xl text-[clamp(2rem,5vw,3.25rem)] font-semibold leading-[1.08] tracking-tight text-foreground">
          Inventory that updates itself when a bill is cut.
        </h1>
        <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-muted-foreground">
          Recipes tied to stock, low-stock alerts before you run out, real per-item food cost, and
          purchase orders that receive straight into inventory — one system instead of billing in
          one place and stock in a spreadsheet.
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
            From recipe to stock count, in one place.
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
          Haryana</strong> — real recipes, real stock deductions, real low-stock alerts, every day.
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
