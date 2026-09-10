import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteHeader } from '@/components/marketing/site-header'
import { SiteFooter } from '@/components/marketing/site-footer'
import { Button } from '@/components/ui/button'
import { SITE_URL, faqJsonLd, breadcrumbJsonLd, jsonLdGraph } from '@/lib/seo'
import { FAQ_CATEGORIES, ALL_FAQS } from '@/lib/faq-data'

export const metadata: Metadata = {
  title: 'FAQ — Restaurant & Café POS Questions Answered',
  description:
    '100 answered questions on restaurant and café POS software — billing, GST, QR ordering, KDS, tables, CRM, loyalty, inventory, reports, payments and choosing software.',
  alternates: { canonical: '/faq' },
  openGraph: {
    title: 'Restaurant & Café POS — Frequently Asked Questions · KhaoPiyo',
    description:
      'Direct answers to real questions café and restaurant owners search — POS, GST billing, QR ordering, kitchen display, CRM, loyalty, inventory and more.',
    url: `${SITE_URL}/faq`,
    type: 'website',
  },
}

// A link to a real product/article page most relevant to each cluster —
// only real paths, matching the same set the blog articles link to.
const CATEGORY_LINKS: Record<string, { label: string; href: string }> = {
  'Restaurant & café POS basics': { label: 'The full platform', href: '/restaurant-pos-software' },
  'GST billing & tax invoicing': { label: 'GST billing software for restaurants', href: '/gst-billing-software-for-restaurants' },
  'QR ordering & digital menus': { label: 'QR code ordering system', href: '/qr-code-ordering-system' },
  'Kitchen display systems & KOT': { label: 'Kitchen display system', href: '/kitchen-display-system' },
  'Table management & Live Tables': { label: 'POS & billing software', href: '/pos-billing-software' },
  'Customer CRM, loyalty, coupons, Spin & Win, wallet': { label: 'Using customer data to bring guests back', href: '/blog/customer-data-increase-repeat-orders' },
  'Payments & receipts': { label: 'POS & billing software', href: '/pos-billing-software' },
  'Staff management & reports': { label: 'POS & billing software', href: '/pos-billing-software' },
  'Inventory, recipes, purchases & multi-café operations': { label: 'Restaurant inventory management software', href: '/restaurant-inventory-management-software' },
  'Choosing, switching & operating software': { label: 'Switching restaurant POS software without losing a shift', href: '/blog/switching-restaurant-pos-software-checklist' },
}

function slugifyCategory(category: string): string {
  return category.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

export default function FaqPage() {
  return (
    <div className="min-h-dvh bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdGraph(
            faqJsonLd(ALL_FAQS),
            breadcrumbJsonLd([{ name: 'FAQ', path: '/faq' }]),
          ),
        }}
      />
      <SiteHeader />

      <section className="mx-auto w-full max-w-3xl px-6 pt-20 pb-8 text-center">
        <p className="text-[13px] font-medium uppercase tracking-wide text-primary">FAQ</p>
        <h1 className="mt-3 font-display text-[clamp(2rem,5vw,3.25rem)] font-semibold tracking-tight text-foreground">
          Questions café and restaurant owners actually ask.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-[16px] leading-relaxed text-muted-foreground">
          {ALL_FAQS.length} answered questions on POS billing, GST, QR ordering, kitchen displays,
          tables, customers, inventory and choosing the right software — grouped by topic below.
        </p>
      </section>

      <nav className="mx-auto w-full max-w-3xl px-6 pb-16" aria-label="FAQ categories">
        <ul className="flex flex-wrap justify-center gap-2">
          {FAQ_CATEGORIES.map((c) => (
            <li key={c.category}>
              <a
                href={`#${slugifyCategory(c.category)}`}
                className="inline-block rounded-full border border-border bg-surface px-4 py-1.5 text-[13px] text-foreground hover:border-border-strong"
              >
                {c.category}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {FAQ_CATEGORIES.map((c, i) => {
        const link = CATEGORY_LINKS[c.category]
        return (
          <section
            key={c.category}
            id={slugifyCategory(c.category)}
            className={`scroll-mt-20 ${i % 2 === 0 ? 'border-y border-border bg-surface' : ''}`}
          >
            <div className="mx-auto w-full max-w-3xl px-6 py-16">
              <h2 className="text-[clamp(1.4rem,3.2vw,1.85rem)] font-semibold tracking-tight text-foreground">
                {c.category}
              </h2>
              <div className="mt-8 divide-y divide-border border-t border-border">
                {c.faqs.map((f) => (
                  <div key={f.q} className="py-5">
                    <h3 className="text-[15px] font-medium text-foreground">{f.q}</h3>
                    <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{f.a}</p>
                  </div>
                ))}
              </div>
              {link && (
                <p className="mt-6 text-[13.5px] text-muted-foreground">
                  More on this:{' '}
                  <Link href={link.href} className="font-medium text-primary hover:underline">
                    {link.label}
                  </Link>
                </p>
              )}
            </div>
          </section>
        )
      })}

      <section className="mx-auto w-full max-w-4xl px-6 py-20 text-center">
        <h2 className="text-[clamp(1.35rem,3vw,1.9rem)] font-semibold tracking-tight text-foreground">
          Still have a question?
        </h2>
        <p className="mx-auto mt-3 max-w-md text-[15px] text-muted-foreground">
          Or set up your menu and see how it actually works — no card required.
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Link href="/contact">
            <Button size="lg" variant="secondary">Contact us</Button>
          </Link>
          <Link href="/get-started">
            <Button size="lg">Start free</Button>
          </Link>
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
