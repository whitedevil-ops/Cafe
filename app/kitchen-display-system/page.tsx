import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteHeader } from '@/components/marketing/site-header'
import { SiteFooter } from '@/components/marketing/site-footer'
import { Button } from '@/components/ui/button'
import { SITE_URL, faqJsonLd, breadcrumbJsonLd, jsonLdGraph, type Faq } from '@/lib/seo'

export const metadata: Metadata = {
  title: 'Kitchen Display System (KDS) for Restaurants',
  description:
    'A kitchen display system that replaces shouted orders and paper tickets. Counter and QR orders on one screen, elapsed timers, late-order flags, and KOT printing when you want it.',
  keywords: [
    'kitchen display system', 'KDS for restaurants', 'kitchen order display India',
    'restaurant KDS software', 'KOT display system', 'digital kitchen order ticket',
  ],
  alternates: { canonical: '/kitchen-display-system' },
  openGraph: {
    title: 'Kitchen Display System (KDS) · KhaoPiyo',
    description:
      'Every order — counter or QR — on one kitchen screen, in the order it arrived, with timers that flag what is running late.',
    url: `${SITE_URL}/kitchen-display-system`,
    type: 'website',
  },
}

const features = [
  {
    title: 'Every order on one board',
    body: 'An order billed at the counter and an order scanned from table 6 arrive on the same screen, in the order they were placed. There is no second queue to remember to check.',
  },
  {
    title: 'A timer on every ticket',
    body: 'Each ticket shows how many minutes it has been waiting, and the counter keeps climbing on its own. Past eight minutes the ticket outlines itself in red, so the thing that has been sitting longest is the thing you notice first.',
  },
  {
    title: 'A sound when something new lands',
    body: 'New orders ring a short two-tone alert, pitched to cut through an exhaust fan rather than get lost under it. One tap arms it at the start of a shift — browsers will not play sound before that.',
  },
  {
    title: 'Placed, preparing, ready',
    body: 'A ticket moves forward with one tap: start it, mark it ready, clear it. The floor sees the same status on the Live Tables screen, so nobody has to walk to the pass to find out whether table 4 is up.',
  },
  {
    title: 'Built to be read from two metres away',
    body: 'Dark screen, large type, quantities in a colour of their own, and a Done button big enough to hit with the back of a knuckle. It is designed for a cheap tablet propped against a wall in a hot kitchen.',
  },
  {
    title: 'It does not go blank when the Wi-Fi does',
    body: 'If the connection drops, the last board stays on screen with a clear offline notice and it keeps retrying in the background. A patchy café connection should not erase what the kitchen is already cooking.',
  },
]

const faqs: Faq[] = [
  {
    q: 'What is a kitchen display system?',
    a: 'A KDS is a screen in the kitchen that shows incoming orders instead of printing them on paper. Orders appear the moment they are placed, each one shows how long it has been waiting, and a cook clears the ticket when the dish goes out. It replaces the paper KOT and the habit of shouting orders across the pass.',
  },
  {
    q: 'Do I need special hardware for the kitchen display?',
    a: 'No. It runs in a web browser, so any tablet, laptop or old computer with a screen will do. Most cafés use an inexpensive Android tablet on a wall mount and a charger.',
  },
  {
    q: 'Does it replace the KOT printer, or can I use both?',
    a: 'Either. Many kitchens run the display alone and drop paper entirely. If your cooks prefer a physical ticket, KhaoPiyo can print a KOT to a 58mm or 80mm thermal printer as well — the display and the printed ticket are not exclusive.',
  },
  {
    q: 'Do QR orders from guests reach the kitchen automatically?',
    a: 'Yes. An order placed from a guest\'s phone via a table QR goes straight to the kitchen display alongside counter orders, with the table number on the ticket. No one at the counter has to re-enter it.',
  },
  {
    q: 'What happens if the internet drops mid-service?',
    a: 'The board keeps showing the last set of orders it received and displays an offline notice rather than clearing itself, and reconnects on its own once the connection returns. It is honest about being offline, but it does not lose what is already on screen. New orders cannot arrive while the connection is down.',
  },
  {
    q: 'Can I see how long orders are actually taking?',
    a: 'Yes. The Operations report measures turnaround — how long orders took from placed to done — along with peak load by hour, so the eight-minute feeling at the pass can be checked against what actually happened last week.',
  },
]

export default function KitchenDisplaySystemPage() {
  return (
    <div className="min-h-dvh bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdGraph(
            faqJsonLd(faqs),
            breadcrumbJsonLd([{ name: 'Kitchen display system', path: '/kitchen-display-system' }]),
          ),
        }}
      />
      <SiteHeader />

      <section className="mx-auto w-full max-w-4xl px-6 py-16 md:py-24">
        <span className="inline-flex items-center rounded-full border border-border bg-surface px-3 py-1 text-[12px] font-medium text-muted-foreground">
          Kitchen display
        </span>
        <h1 className="mt-5 max-w-2xl text-[clamp(2rem,5vw,3.25rem)] font-semibold leading-[1.08] tracking-tight text-foreground">
          The kitchen stops guessing what&apos;s next.
        </h1>
        <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-muted-foreground">
          Every order — billed at the counter or scanned from a table — lands on one screen in the
          order it arrived, with a timer that keeps climbing until someone clears it. No paper
          tickets to lose, and nothing shouted across the pass.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/get-started">
            <Button size="lg">Start free</Button>
          </Link>
          <Link href="/restaurant-pos-software">
            <Button variant="secondary" size="lg">See the full platform</Button>
          </Link>
        </div>
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto w-full max-w-6xl px-6 py-20">
          <h2 className="max-w-xl text-[clamp(1.75rem,4vw,2.5rem)] font-semibold tracking-tight text-foreground">
            Designed for a hot kitchen, not a boardroom demo.
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
          Where the paper ticket actually costs you
        </h2>
        <div className="mt-8 grid gap-8 sm:grid-cols-2">
          <div>
            <h3 className="text-[15px] font-medium text-foreground">A ticket falls behind the counter</h3>
            <p className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">
              On paper, nobody finds out until the guest asks. On the display, that order is still
              on screen with an eighteen-minute timer and a red outline.
            </p>
          </div>
          <div>
            <h3 className="text-[15px] font-medium text-foreground">The printer runs out of roll</h3>
            <p className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">
              Orders stop reaching the kitchen and nobody notices for several minutes. A screen has
              no consumable to run out of.
            </p>
          </div>
          <div>
            <h3 className="text-[15px] font-medium text-foreground">An item gets modified after ordering</h3>
            <p className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">
              A printed ticket is already wrong the moment it prints. The board reflects what the
              order is now, including notes taken at the counter.
            </p>
          </div>
          <div>
            <h3 className="text-[15px] font-medium text-foreground">Nobody knows what the wait really is</h3>
            <p className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">
              Paper leaves no record of timing. Every ticket cleared here contributes to a
              turnaround figure you can look at later.
            </p>
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto w-full max-w-4xl px-6 py-16">
          <h2 className="text-[clamp(1.5rem,3.5vw,2rem)] font-semibold tracking-tight text-foreground">
            Running live, not just in a demo.
          </h2>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            KhaoPiyo&apos;s first café is{' '}
            <strong className="font-medium text-foreground">Brewora Café in Hisar, Haryana</strong>,
            where the kitchen display runs through service every day. The eight-minute late flag is
            there because that is where the pass starts feeling behind — not because it tested well
            in a slide.
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
        <div className="mx-auto w-full max-w-4xl px-6 py-16">
          <h2 className="text-[clamp(1.25rem,3vw,1.75rem)] font-semibold tracking-tight text-foreground">
            Go deeper on a specific module
          </h2>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <Link href="/qr-code-ordering-system" className="rounded-xl border border-border bg-background p-5 hover:border-border-strong">
              <p className="text-sm font-medium text-foreground">QR ordering system</p>
              <p className="mt-1 text-[13px] text-muted-foreground">Where half these tickets come from.</p>
            </Link>
            <Link href="/pos-billing-software" className="rounded-xl border border-border bg-background p-5 hover:border-border-strong">
              <p className="text-sm font-medium text-foreground">POS &amp; billing software</p>
              <p className="mt-1 text-[13px] text-muted-foreground">The counter side of the same order.</p>
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
