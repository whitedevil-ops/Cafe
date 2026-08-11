import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteHeader } from '@/components/marketing/site-header'
import { SiteFooter } from '@/components/marketing/site-footer'
import { Button } from '@/components/ui/button'
import { SITE_URL, breadcrumbJsonLd, jsonLdGraph } from '@/lib/seo'

export const metadata: Metadata = {
  title: 'About KhaoPiyo — Restaurant POS Software by Ventron',
  description:
    'KhaoPiyo is café and restaurant POS software built in Hisar, Haryana by Ventron. Who it is for, what it does, and what it deliberately does not do.',
  keywords: [
    'about KhaoPiyo', 'KhaoPiyo Ventron', 'restaurant POS company India',
    'restaurant software Hisar', 'Indian restaurant POS software company',
  ],
  alternates: { canonical: '/about' },
  openGraph: {
    title: 'About KhaoPiyo — Restaurant POS Software by Ventron',
    description:
      'Café and restaurant POS software built in Hisar, Haryana by Ventron. Running live in a real café, not just a demo.',
    url: `${SITE_URL}/about`,
    type: 'website',
  },
}

export default function AboutPage() {
  return (
    <div className="min-h-dvh bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdGraph(breadcrumbJsonLd([{ name: 'About', path: '/about' }])),
        }}
      />
      <SiteHeader />

      <section className="mx-auto w-full max-w-3xl px-6 pt-20 pb-10">
        <p className="text-[13px] font-medium uppercase tracking-wide text-primary">About</p>
        <h1 className="mt-3 font-display text-[clamp(2rem,5vw,3rem)] font-semibold tracking-tight text-foreground">
          Restaurant software built where the restaurants are.
        </h1>
        <p className="mt-6 text-[16.5px] leading-relaxed text-muted-foreground">
          KhaoPiyo is point-of-sale and operations software for cafés and restaurants in India. It
          handles billing and GST invoices, QR ordering from a guest&apos;s own phone, the kitchen
          display, tables, menu, inventory, reports and loyalty — in one system rather than four
          that do not talk to each other.
        </p>
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto w-full max-w-3xl px-6 py-16">
          <h2 className="text-[clamp(1.5rem,3.5vw,2rem)] font-semibold tracking-tight text-foreground">
            Who builds it
          </h2>
          <p className="mt-4 text-[15.5px] leading-relaxed text-muted-foreground">
            KhaoPiyo is a product of{' '}
            <a
              href="https://ventron.in"
              className="font-medium text-primary hover:underline"
              rel="noopener"
            >
              Ventron
            </a>
            , a software company based in Hisar, Haryana. Ventron builds and runs its own products
            rather than taking client projects, which is why the same people who write the billing
            engine are the ones who hear about it when a bill is wrong.
          </p>
          <p className="mt-4 text-[15.5px] leading-relaxed text-muted-foreground">
            Being built in a tier-2 city is not incidental. Most restaurant software in India is
            designed around large chains in metros and then sold down-market with features removed.
            KhaoPiyo started from the opposite end: a single independent café, one counter, one
            person who cannot afford for the bill to be wrong on a Saturday night.
          </p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-3xl px-6 py-16">
        <h2 className="text-[clamp(1.5rem,3.5vw,2rem)] font-semibold tracking-tight text-foreground">
          Running live, in a real café
        </h2>
        <p className="mt-4 text-[15.5px] leading-relaxed text-muted-foreground">
          KhaoPiyo&apos;s first café is{' '}
          <strong className="font-medium text-foreground">Brewora Café in Hisar, Haryana</strong>.
          Every part of the platform — counter billing, QR ordering, the kitchen display, GST
          invoices, stock — runs there in daily service. Features get built because something at
          Brewora was slow or wrong, not because a competitor&apos;s feature list had a gap.
        </p>
        <p className="mt-4 text-[15.5px] leading-relaxed text-muted-foreground">
          We are early, and would rather say so than pretend otherwise. There is no wall of logos on
          this site because there is not yet a wall of logos to show.
        </p>
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto w-full max-w-3xl px-6 py-16">
          <h2 className="text-[clamp(1.5rem,3.5vw,2rem)] font-semibold tracking-tight text-foreground">
            What it deliberately doesn&apos;t do
          </h2>
          <p className="mt-4 text-[15.5px] leading-relaxed text-muted-foreground">
            Knowing what software does not do saves everyone a sales call.
          </p>
          <ul className="mt-6 space-y-3 text-[15px] leading-relaxed text-muted-foreground">
            <li>
              <strong className="font-medium text-foreground">No aggregator integration.</strong>{' '}
              Orders from Swiggy and Zomato do not flow in automatically today. KhaoPiyo handles
              orders placed directly — at the counter, or through its own QR ordering.
            </li>
            <li>
              <strong className="font-medium text-foreground">No proprietary hardware.</strong>{' '}
              It runs in a browser on a computer or tablet you already own. There is no terminal to
              buy and nothing to rent.
            </li>
            <li>
              <strong className="font-medium text-foreground">No commission on your sales.</strong>{' '}
              A flat subscription, and no percentage of what you take.
            </li>
          </ul>
        </div>
      </section>

      <section className="mx-auto w-full max-w-3xl px-6 py-16 text-center">
        <h2 className="text-[clamp(1.35rem,3vw,1.9rem)] font-semibold tracking-tight text-foreground">
          Have a look for yourself.
        </h2>
        <p className="mx-auto mt-3 max-w-md text-[15px] text-muted-foreground">
          Set up your menu and print a test bill before paying anything.
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Link href="/get-started">
            <Button size="lg">Start free</Button>
          </Link>
          <Link href="/contact">
            <Button size="lg" variant="secondary">Talk to us</Button>
          </Link>
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
