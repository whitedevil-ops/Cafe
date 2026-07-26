import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { SiteHeader } from '@/components/marketing/site-header'
import { SiteFooter } from '@/components/marketing/site-footer'

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

export const metadata: Metadata = {
  title: 'Petpooja Alternative — Simpler POS Billing for Cafés',
  description:
    'Comparing Petpooja alternatives? KhaoPiyo is cloud-first café POS billing software — flat monthly pricing, no bundled hardware or setup fees, GST invoicing and QR ordering built in.',
  alternates: { canonical: '/petpooja-alternative' },
  openGraph: {
    title: 'Petpooja Alternative — Simpler POS Billing for Cafés · KhaoPiyo',
    description:
      'Cloud-first café POS billing software with flat monthly pricing, GST invoicing and QR ordering — an alternative to Petpooja and other legacy restaurant POS platforms.',
    url: `${siteUrl}/petpooja-alternative`,
    type: 'website',
  },
}

const rows: [string, string, string][] = [
  ['Setup', 'Sign up and start billing the same day, from a browser', 'Typically involves onboarding, staff training and a setup process'],
  ['Hardware', 'Works on any laptop, tablet or phone — printer optional', 'Often bundled with dedicated billing hardware'],
  ['Pricing', 'Flat ₹999–₹4,999/month, shown upfront, no add-on modules', 'Reported around ₹3,000–₹12,000/month plus GST, with extra modules priced separately'],
  ['QR ordering', 'Included from the Starter plan', 'Typically available as part of a higher-tier plan or add-on'],
  ['GST invoicing', 'CGST/SGST split, HSN/SAC codes, sequential invoice numbers — included', 'Available, generally on paid tiers'],
  ['Best fit', 'Independent cafés and small chains that want to move fast', 'Larger multi-outlet chains needing aggregator (Swiggy/Zomato) integration'],
]

const faqs = [
  {
    q: 'What is a good Petpooja alternative for a small café?',
    a: 'If you run one or two outlets and want to start billing the same day without a hardware setup or onboarding process, KhaoPiyo is built for exactly that — cloud-based POS billing, QR ordering and GST invoicing from a flat monthly plan.',
  },
  {
    q: 'Is KhaoPiyo cheaper than Petpooja?',
    a: 'KhaoPiyo\'s plans are ₹999, ₹2,499 and ₹4,999 per month, shown in full with no separate setup or hardware charges. Petpooja and similar established platforms are widely reported in the ₹3,000–₹12,000/month range once GST, setup and hardware are added — but confirm current pricing directly with any vendor before deciding.',
  },
  {
    q: 'Does switching from Petpooja to KhaoPiyo require new hardware?',
    a: 'No. KhaoPiyo runs in a browser on whatever device you already have. A receipt printer is optional, not required.',
  },
  {
    q: 'Is KhaoPiyo suitable for a large multi-outlet restaurant chain?',
    a: 'KhaoPiyo is built primarily for independent cafés and small chains. Very large multi-outlet operations that depend heavily on food-aggregator integrations may still be better served by an established platform like Petpooja — we\'d rather say that plainly than oversell.',
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

export default function PetpoojaAlternativePage() {
  return (
    <div className="flex w-full min-h-dvh flex-col bg-background">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <SiteHeader />

      <section className="mx-auto w-full max-w-4xl px-6 py-16 md:py-24">
        <span className="inline-flex items-center rounded-full border border-border bg-surface px-3 py-1 text-[12px] font-medium text-muted-foreground">
          Petpooja alternative
        </span>
        <h1 className="mt-5 max-w-2xl text-[clamp(2rem,5vw,3.25rem)] font-semibold leading-[1.08] tracking-tight text-foreground">
          Looking for a Petpooja alternative?
        </h1>
        <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-muted-foreground">
          Petpooja is a well-established restaurant POS platform used by a large number of outlets
          across India, built around counter billing, hardware, and food-aggregator integrations.
          If you run an independent café or a small chain and want something you can set up in an
          afternoon — cloud-first, flat pricing, no bundled hardware — that&apos;s where KhaoPiyo fits.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/signup">
            <Button size="lg">Start free</Button>
          </Link>
          <Link href="/pos-billing-software">
            <Button variant="secondary" size="lg">See all billing features</Button>
          </Link>
        </div>
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto w-full max-w-4xl px-6 py-16">
          <h2 className="text-[clamp(1.5rem,3.5vw,2rem)] font-semibold tracking-tight text-foreground">
            How they compare
          </h2>
          <div className="mt-8 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[640px] text-left text-[13.5px]">
              <thead className="bg-surface-subtle text-[12px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium"></th>
                  <th className="px-4 py-3 font-medium text-primary">KhaoPiyo</th>
                  <th className="px-4 py-3 font-medium">Traditional POS platforms (e.g. Petpooja)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-background">
                {rows.map(([label, us, them]) => (
                  <tr key={label}>
                    <td className="px-4 py-3.5 font-medium text-foreground">{label}</td>
                    <td className="px-4 py-3.5 text-foreground">{us}</td>
                    <td className="px-4 py-3.5 text-muted-foreground">{them}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-[12px] text-muted-foreground">
            Comparison based on publicly available pricing and feature information as of 2026 and may not
            reflect current plans — confirm directly with any vendor before switching. &ldquo;Petpooja&rdquo;
            is a trademark of its respective owner; KhaoPiyo is not affiliated with or endorsed by Petpooja.
          </p>
        </div>
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
        <div className="mx-auto w-full max-w-4xl px-6 py-20 text-center">
          <h2 className="text-[clamp(1.5rem,3.5vw,2rem)] font-semibold tracking-tight text-foreground">
            Switch in an afternoon, not a quarter.
          </h2>
          <p className="mx-auto mt-3 max-w-md text-[15px] text-muted-foreground">
            Set up your menu, generate your table QR codes, and start billing — no hardware order,
            no onboarding call required.
          </p>
          <div className="mt-8">
            <Link href="/signup">
              <Button size="lg">Start free</Button>
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
