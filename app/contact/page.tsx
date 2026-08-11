import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteHeader } from '@/components/marketing/site-header'
import { SiteFooter } from '@/components/marketing/site-footer'
import { Button } from '@/components/ui/button'
import { SITE_URL, breadcrumbJsonLd, jsonLdGraph } from '@/lib/seo'

export const metadata: Metadata = {
  title: 'Contact KhaoPiyo — Restaurant POS Software Support',
  description:
    'Get in touch about KhaoPiyo café and restaurant POS software — setup, pricing, migrating your menu, or a demo. Built in Hisar, Haryana by Ventron.',
  keywords: [
    'contact KhaoPiyo', 'restaurant POS software demo', 'restaurant POS support India',
    'café POS software enquiry', 'KhaoPiyo support',
  ],
  alternates: { canonical: '/contact' },
  openGraph: {
    title: 'Contact KhaoPiyo — Restaurant POS Software',
    description:
      'Questions about setup, pricing or migrating your menu? Tell us about your café and we will get back to you.',
    url: `${SITE_URL}/contact`,
    type: 'website',
  },
}

// Only channels that genuinely exist. No invented phone number, no support
// address that nobody monitors — a contact page that lists a dead channel is
// worse than one that lists fewer live ones.
const reasons = [
  {
    title: 'You run a café and want to try it',
    body: 'Register and set up your menu, tables and staff before paying anything. It is the fastest way to see whether it fits how you work.',
    href: '/get-started',
    cta: 'Start free',
  },
  {
    title: 'You want a walkthrough first',
    body: 'Tell us about your café — how many tables, whether you do takeaway, what you bill on now — and we will come back to you rather than putting you through a form and a sales sequence.',
    href: '/get-started',
    cta: 'Tell us about your café',
  },
]

export default function ContactPage() {
  return (
    <div className="min-h-dvh bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdGraph(breadcrumbJsonLd([{ name: 'Contact', path: '/contact' }])),
        }}
      />
      <SiteHeader />

      <section className="mx-auto w-full max-w-3xl px-6 pt-20 pb-10">
        <p className="text-[13px] font-medium uppercase tracking-wide text-primary">Contact</p>
        <h1 className="mt-3 font-display text-[clamp(2rem,5vw,3rem)] font-semibold tracking-tight text-foreground">
          Talk to the people who build it.
        </h1>
        <p className="mt-6 text-[16.5px] leading-relaxed text-muted-foreground">
          KhaoPiyo is small enough that the person answering your question is the person who wrote
          the code. If something is broken, say so plainly — it gets fixed faster that way.
        </p>
      </section>

      <section className="mx-auto w-full max-w-3xl px-6 pb-16">
        <div className="grid gap-4 sm:grid-cols-2">
          {reasons.map((r) => (
            <div key={r.title} className="flex flex-col rounded-xl border border-border bg-surface p-6">
              <h2 className="text-[15.5px] font-medium text-foreground">{r.title}</h2>
              <p className="mt-2 flex-1 text-[14px] leading-relaxed text-muted-foreground">{r.body}</p>
              <Link href={r.href} className="mt-5">
                <Button className="w-full">{r.cta}</Button>
              </Link>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto w-full max-w-3xl px-6 py-16">
          <h2 className="text-[clamp(1.5rem,3.5vw,2rem)] font-semibold tracking-tight text-foreground">
            Where we are
          </h2>
          <p className="mt-4 text-[15.5px] leading-relaxed text-muted-foreground">
            KhaoPiyo is built in <strong className="font-medium text-foreground">Hisar, Haryana</strong>{' '}
            by{' '}
            <a href="https://ventron.in" className="font-medium text-primary hover:underline" rel="noopener">
              Ventron
            </a>
            . The software is cloud-based and works anywhere in India — cafés in Gurugram, Noida,
            Pune or Bengaluru run the same platform as the one in Hisar, with nothing to install
            beyond a browser.
          </p>
          <div className="mt-8 space-y-3 text-[14.5px] text-muted-foreground">
            <p>
              <strong className="font-medium text-foreground">Privacy and data requests:</strong>{' '}
              <a href="mailto:privacy@ventron.in" className="text-primary hover:underline">privacy@ventron.in</a>
            </p>
            <p>
              <strong className="font-medium text-foreground">Grievance officer:</strong>{' '}
              <a href="mailto:grievance@ventron.in" className="text-primary hover:underline">grievance@ventron.in</a>
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-3xl px-6 py-16">
        <h2 className="text-[clamp(1.35rem,3vw,1.75rem)] font-semibold tracking-tight text-foreground">
          Answers you might not need to ask for
        </h2>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Link href="/pricing" className="rounded-xl border border-border bg-surface p-5 hover:border-border-strong">
            <p className="text-sm font-medium text-foreground">Pricing</p>
            <p className="mt-1 text-[13px] text-muted-foreground">Published upfront, no quote needed.</p>
          </Link>
          <Link href="/about" className="rounded-xl border border-border bg-surface p-5 hover:border-border-strong">
            <p className="text-sm font-medium text-foreground">About KhaoPiyo</p>
            <p className="mt-1 text-[13px] text-muted-foreground">Who builds it, and what it doesn&apos;t do.</p>
          </Link>
          <Link href="/pos-billing-software" className="rounded-xl border border-border bg-surface p-5 hover:border-border-strong">
            <p className="text-sm font-medium text-foreground">The platform</p>
            <p className="mt-1 text-[13px] text-muted-foreground">Billing, QR, kitchen, inventory.</p>
          </Link>
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
