import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteHeader } from '@/components/marketing/site-header'
import { SiteFooter } from '@/components/marketing/site-footer'
import { Button } from '@/components/ui/button'

// A 404 that recovers the visit instead of ending it. Next's default page is
// unbranded and has no way out, so anyone who mistypes a URL or follows a
// stale link simply leaves — and crawlers find a dead end with no path back
// into the site.
export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: true },
}

const routes = [
  { href: '/pos-billing-software', label: 'POS & billing software', hint: 'The full platform, end to end.' },
  { href: '/pricing', label: 'Pricing', hint: 'Three plans, published upfront.' },
  { href: '/qr-code-ordering-system', label: 'QR ordering', hint: 'Guests order from their own phone.' },
  { href: '/gst-billing-software-for-restaurants', label: 'GST billing', hint: 'Correct tax invoice, every bill.' },
  { href: '/restaurant-inventory-management-software', label: 'Inventory & recipes', hint: 'Stock that deducts itself.' },
  { href: '/about', label: 'About KhaoPiyo', hint: 'Who builds it, and why.' },
]

export default function NotFound() {
  return (
    <div className="min-h-dvh bg-background">
      <SiteHeader />

      <section className="mx-auto w-full max-w-3xl px-6 pt-24 pb-12 text-center">
        <p className="text-[13px] font-medium uppercase tracking-wide text-primary">404</p>
        <h1 className="mt-3 font-display text-[clamp(1.85rem,4.5vw,2.75rem)] font-semibold tracking-tight text-foreground">
          That page isn&apos;t here.
        </h1>
        <p className="mx-auto mt-4 max-w-md text-[15.5px] leading-relaxed text-muted-foreground">
          The link may be old, or the address slightly off. Everything below is still where it
          should be.
        </p>
        <Link href="/" className="mt-7 inline-block">
          <Button size="lg">Back to home</Button>
        </Link>
      </section>

      <section className="mx-auto w-full max-w-4xl px-6 pb-24">
        <div className="grid gap-3 sm:grid-cols-2">
          {routes.map((r) => (
            <Link
              key={r.href}
              href={r.href}
              className="rounded-xl border border-border bg-surface p-5 hover:border-border-strong"
            >
              <p className="text-sm font-medium text-foreground">{r.label}</p>
              <p className="mt-1 text-[13px] text-muted-foreground">{r.hint}</p>
            </Link>
          ))}
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
