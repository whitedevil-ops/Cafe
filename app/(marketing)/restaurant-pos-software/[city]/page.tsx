import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { SiteHeader } from '@/components/marketing/site-header'
import { SiteFooter } from '@/components/marketing/site-footer'
import { Button } from '@/components/ui/button'
import { SITE_URL, faqJsonLd, breadcrumbJsonLd, jsonLdGraph, type Faq } from '@/lib/seo'

// Location pages, and the line this stays on the right side of.
//
// A city page earns its place when it answers something a café owner in that
// city actually has to think about. It becomes spam when it is one template
// with the name swapped — so the market context, the kinds of places served,
// and the operational pressure below are written per city, and only the
// product facts are shared, because those genuinely are the same everywhere.
//
// Five cities, not fifty. Every one of them is somewhere there is a real
// reason to be: where KhaoPiyo is built, or where its clearest demand is.

type City = {
  slug: string
  name: string
  region: string
  /** How a café owner there would phrase the search. */
  searchPhrase: string
  intro: string
  market: string
  pressure: { title: string; body: string }[]
  venues: string[]
  faqs: Faq[]
}

const CITIES: City[] = [
  {
    slug: 'hisar',
    name: 'Hisar',
    region: 'Haryana',
    searchPhrase: 'restaurant POS software in Hisar',
    intro:
      'KhaoPiyo is built in Hisar, and the first café running it is here. If you are looking for billing software for a café or restaurant in Hisar, this is the one place where the people writing it are down the road rather than in another state.',
    market:
      'Hisar runs on independent places rather than chains — a single owner who is also the manager, often on the floor during the rush. Software sold to 50-outlet groups in Delhi assumes a back office, an IT person and a training budget. None of that exists here, so anything that needs a week of setup or a support ticket to change a price is dead on arrival.',
    pressure: [
      {
        title: 'One person is doing three jobs',
        body: 'The owner is billing, checking the kitchen and greeting regulars in the same ten minutes. Software has to be usable without stopping to think — which is why billing is one screen, not a menu tree.',
      },
      {
        title: 'Staff turnover is real',
        body: 'New counter staff need to bill correctly on their first shift, not after training. Roles limit what each person can do, so handing someone a login is not handing them the whole business.',
      },
      {
        title: 'Margins are thin and visible',
        body: 'When one person owns the place, wastage comes out of their pocket directly. Recipe costing and stock deduction show where the money is going before the month ends.',
      },
    ],
    venues: ['Independent cafés', 'Family restaurants', 'Bakeries and sweet shops', 'Takeaway counters'],
    faqs: [
      {
        q: 'Is KhaoPiyo actually used by a café in Hisar?',
        a: 'Yes — Brewora Café in Hisar runs on it in daily service. It is where the billing, kitchen display and inventory get tested against real customers rather than a demo script.',
      },
      {
        q: 'Do I need an internet connection at all times in Hisar?',
        a: 'You need a connection to bill, since KhaoPiyo is cloud-based and your data lives on the server rather than one computer. The kitchen display and QR menu handle brief drops without losing orders, but a working connection is the honest requirement.',
      },
      {
        q: 'Can I get help setting up my menu?',
        a: 'You can import a menu from an Excel or CSV file, including sizes and add-ons, rather than typing every item. If your menu is a photo or a printed card, the importer takes a spreadsheet you fill in, and we would rather help you get that right than have you retype 120 items.',
      },
    ],
  },
  {
    slug: 'gurugram',
    name: 'Gurugram',
    region: 'Haryana',
    searchPhrase: 'restaurant POS software in Gurgaon',
    intro:
      'Cafés and restaurants in Gurugram deal with a lunch rush shaped by office towers and an evening trade shaped by everything else. Billing software that cannot keep up with 90 covers in 45 minutes is not a small inconvenience here.',
    market:
      'Gurugram concentrates a large working population into a narrow lunch window, which puts unusual pressure on speed of billing and on the kitchen keeping order. It is also a market where guests expect to pay by UPI without being handed a machine, and where a queue at the counter is a lost table rather than a minor delay.',
    pressure: [
      {
        title: 'The rush is compressed, not spread',
        body: 'A weekday lunch can be most of the day\'s covers in under an hour. QR ordering lets guests order without waiting for staff, and the kitchen display gets each ticket the moment it is placed rather than when someone walks it over.',
      },
      {
        title: 'Corporate guests want a proper invoice',
        body: 'Expense claims mean GST invoices get scrutinised. Sequential numbering, correct CGST/SGST split and HSN/SAC per item are generated on every bill, not on request.',
      },
      {
        title: 'Table turnaround is the constraint',
        body: 'Live table view shows what is occupied, what is waiting on a bill, and how long each has been sitting — the numbers that decide whether you seat the queue or lose it.',
      },
    ],
    venues: ['Office-district cafés', 'Casual dining restaurants', 'Cloud kitchens', 'Speciality coffee bars'],
    faqs: [
      {
        q: 'Can guests order and pay from their phone without staff?',
        a: 'Yes. A table QR opens the menu, the guest orders from their own phone, and the order goes straight to the kitchen display. Paying online is optional and configured per café — some prefer to keep payment at the counter.',
      },
      {
        q: 'Does it handle both dine-in and takeaway in the same rush?',
        a: 'Yes, and they stay separate where it matters: takeaway can be settled immediately at the counter while dine-in bills run against a table until the guest asks for them. Both land on the same kitchen queue.',
      },
      {
        q: 'Do you integrate with Swiggy and Zomato?',
        a: 'Not today. Aggregator orders do not flow in automatically — KhaoPiyo handles orders placed directly at the counter or through its own QR ordering. If most of your volume is aggregator-driven, that is worth knowing before you switch.',
      },
    ],
  },
  {
    slug: 'noida',
    name: 'Noida',
    region: 'Uttar Pradesh',
    searchPhrase: 'restaurant POS software in Noida',
    intro:
      'Restaurants and cafés across Noida and Greater Noida run a mixed trade — office lunches, student crowds and family dinners, often in the same week. Billing software has to handle all three without being configured differently for each.',
    market:
      'Noida spreads across sectors with quite different footfall patterns, so a café in one sector can look nothing like one two kilometres away. What they share is a need for correct GST invoicing under UP state rules and for takeaway to be as quick to bill as dine-in.',
    pressure: [
      {
        title: 'Takeaway is not an afterthought',
        body: 'A large share of orders leave the building. Takeaway billing settles at the counter in one flow, without creating a table or leaving an open bill behind to reconcile later.',
      },
      {
        title: 'Student trade means small, frequent bills',
        body: 'Lots of low-value orders make billing speed matter more than any single feature. Loyalty and coupons are there to bring the same guest back rather than chase a bigger single ticket.',
      },
      {
        title: 'GST has to be right, every bill',
        body: 'Intra-state supply means a CGST/SGST split rather than IGST, generated automatically with sequential invoice numbers your accountant can reconcile at filing time.',
      },
    ],
    venues: ['Sector cafés', 'Student-area eateries', 'Food court counters', 'Delivery-first kitchens'],
    faqs: [
      {
        q: 'Does it handle GST correctly for a restaurant in Uttar Pradesh?',
        a: 'Yes. For supply within the same state — which is the normal case for a restaurant serving guests on the premises — bills carry a CGST and SGST split with sequential invoice numbering and HSN/SAC codes per item. Your GST rate is set per item, so different rates on food and packaged goods are handled.',
      },
      {
        q: 'Can I run more than one outlet?',
        a: 'Each café is its own account with its own menu, staff and reports. There is no combined multi-outlet dashboard today, so two branches means two accounts — worth knowing if consolidated reporting is what you are shopping for.',
      },
      {
        q: 'How quickly can a new counter person learn it?',
        a: 'Billing is one screen: pick items, take payment, done. Roles limit what a counter account can change, so a new person can bill on their first shift without being able to alter prices or see reports.',
      },
    ],
  },
  {
    slug: 'pune',
    name: 'Pune',
    region: 'Maharashtra',
    searchPhrase: 'restaurant POS software in Pune',
    intro:
      'Pune has one of the denser independent café scenes in the country — places built around a specific idea rather than a franchise manual. Software that forces every café into the same shape tends to get abandoned here.',
    market:
      'The mix of students, IT campuses and long-standing local restaurants means a wide spread of formats: speciality coffee, all-day cafés, bakeries, and family restaurants that have been running for decades. Menus are often complex — sizes, brew methods, add-ons — which is where rigid billing software starts to hurt.',
    pressure: [
      {
        title: 'Menus have real variation',
        body: 'One coffee sold four ways at four prices is normal, and add-ons stack on top. Items carry their own sizes and add-ons with per-option pricing and per-option cost, rather than forcing separate menu entries for each combination.',
      },
      {
        title: 'Regulars matter more than footfall',
        body: 'An independent café lives on people who come back. Loyalty points, rewards tied to specific items, and customer history are part of billing rather than a separate app the counter has to remember to open.',
      },
      {
        title: 'Food cost decides whether it works',
        body: 'Speciality menus have wide margin variation between items. Recipes tie each dish to its ingredients so profitability is measured per item, including per-size, instead of guessed at month end.',
      },
    ],
    venues: ['Speciality coffee roasters', 'All-day cafés', 'Bakeries and patisseries', 'Long-standing family restaurants'],
    faqs: [
      {
        q: 'Can it handle a coffee sold in several sizes at different prices?',
        a: 'Yes, and with a different cost per size too — a large latte uses more milk, and its margin is genuinely different. Sizes and add-ons live on the item itself rather than requiring a separate menu entry each.',
      },
      {
        q: 'Does it work for a bakery selling both counter items and dine-in?',
        a: 'Yes. Takeaway and dine-in are independent settings, so a bakery can bill counter sales quickly while still running tables if it has them, or turn tables off entirely.',
      },
      {
        q: 'Is the menu hard to change once set up?',
        a: 'No — prices, availability and photos are edited from the dashboard and reflect immediately on the QR menu guests see. Marking something sold out takes one tap and is visible to guests straight away.',
      },
    ],
  },
  {
    slug: 'bangalore-hsr-layout',
    name: 'HSR Layout, Bengaluru',
    region: 'Karnataka',
    searchPhrase: 'café POS software in HSR Layout',
    intro:
      'HSR Layout has an unusually high density of independent cafés serving a startup and tech crowd — people who will happily scan a QR to order and who notice when the software is clumsy.',
    market:
      'It is a neighbourhood where guests expect the digital experience to be good, not merely present. A QR menu that is slow to load, shows items that are sold out, or looks like a PDF scan reflects on the café rather than the software. Delivery and takeaway volumes are also high, so the same kitchen is often serving two very different queues.',
    pressure: [
      {
        title: 'The guest sees your software',
        body: 'The QR menu is part of the café experience here, not a back-office tool. It loads as a real menu with photos, sizes and veg markers, and hides what is sold out instead of taking an order you cannot fulfil.',
      },
      {
        title: 'One kitchen, two queues',
        body: 'Dine-in and takeaway arrive at the same kitchen at the same time. Both land on one display in the order they were placed, so nothing depends on someone remembering which ticket came first.',
      },
      {
        title: 'People pay by phone',
        body: 'UPI is the default, not the exception. Online payment is available per café and settles against the bill, so the counter is not reconciling screenshots at the end of the night.',
      },
    ],
    venues: ['Speciality cafés', 'Co-working café counters', 'Cloud kitchens', 'Brunch and all-day restaurants'],
    faqs: [
      {
        q: 'Do guests need to install an app to order?',
        a: 'No. Scanning the table QR opens the menu in their phone browser — no app, no signup beyond a name and phone number for the order.',
      },
      {
        q: 'Can guests see photos and sizes on the QR menu?',
        a: 'Yes — the guest menu shows item photos, sizes with their own prices, add-ons and veg or non-veg markers, and hides items that are marked sold out.',
      },
      {
        q: 'Does it work if my café is delivery-heavy?',
        a: 'It handles takeaway and pickup ordering well, including a kitchen display shared with dine-in. It does not currently pull orders from Swiggy or Zomato, so a kitchen whose volume is mostly aggregator-driven would still be keying those in separately.',
      },
    ],
  },
]

function findCity(slug: string) {
  return CITIES.find((c) => c.slug === slug)
}

export function generateStaticParams() {
  return CITIES.map((c) => ({ city: c.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>
}): Promise<Metadata> {
  const { city } = await params
  const c = findCity(city)
  if (!c) return {}
  const path = `/restaurant-pos-software/${c.slug}`
  return {
    title: `Restaurant POS Software in ${c.name} — Billing, QR & GST`,
    description: `Café and restaurant POS billing software for ${c.name}, ${c.region} — GST invoices, QR ordering, kitchen display and inventory. Cloud-based, no hardware to buy.`,
    keywords: [
      `restaurant POS software ${c.name}`,
      `restaurant billing software ${c.name}`,
      `cafe POS software ${c.name}`,
      `cafe billing software ${c.name}`,
      `GST billing software ${c.name}`,
      `POS system for restaurants ${c.region}`,
    ],
    alternates: { canonical: path },
    openGraph: {
      title: `Restaurant POS Software in ${c.name} · KhaoPiyo`,
      description: `POS billing, GST invoicing, QR ordering and inventory for cafés and restaurants in ${c.name}.`,
      url: `${SITE_URL}${path}`,
      type: 'website',
    },
  }
}

export default async function CityPage({ params }: { params: Promise<{ city: string }> }) {
  const { city } = await params
  const c = findCity(city)
  if (!c) notFound()

  const path = `/restaurant-pos-software/${c.slug}`

  return (
    <div className="min-h-dvh bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdGraph(
            faqJsonLd(c.faqs),
            breadcrumbJsonLd([
              { name: 'Restaurant POS software', path: '/restaurant-pos-software' },
              { name: c.name, path },
            ]),
          ),
        }}
      />
      <SiteHeader />

      <section className="mx-auto w-full max-w-3xl px-6 pt-20 pb-10">
        <p className="text-[13px] font-medium uppercase tracking-wide text-primary">
          {c.name}, {c.region}
        </p>
        <h1 className="mt-3 font-display text-[clamp(1.9rem,4.6vw,2.9rem)] font-semibold tracking-tight text-foreground">
          Restaurant POS software in {c.name}.
        </h1>
        <p className="mt-6 text-[16.5px] leading-relaxed text-muted-foreground">{c.intro}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/get-started"><Button size="lg">Start free</Button></Link>
          <Link href="/pricing"><Button size="lg" variant="secondary">See pricing</Button></Link>
        </div>
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto w-full max-w-3xl px-6 py-16">
          <h2 className="text-[clamp(1.5rem,3.5vw,2rem)] font-semibold tracking-tight text-foreground">
            What running a café in {c.name} is actually like
          </h2>
          <p className="mt-4 text-[15.5px] leading-relaxed text-muted-foreground">{c.market}</p>
          <div className="mt-10 space-y-5">
            {c.pressure.map((p) => (
              <div key={p.title} className="rounded-xl border border-border bg-background p-5">
                <h3 className="text-[15px] font-medium text-foreground">{p.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-3xl px-6 py-16">
        <h2 className="text-[clamp(1.5rem,3.5vw,2rem)] font-semibold tracking-tight text-foreground">
          Built for the kinds of places {c.name} has
        </h2>
        <ul className="mt-6 flex flex-wrap gap-2">
          {c.venues.map((v) => (
            <li key={v} className="rounded-full border border-border bg-surface px-4 py-1.5 text-[13.5px] text-foreground">
              {v}
            </li>
          ))}
        </ul>
        <p className="mt-8 text-[15px] leading-relaxed text-muted-foreground">
          KhaoPiyo is cloud software, so a café in {c.name} runs exactly the same platform as the one
          in Hisar where it is built — same billing engine, same GST invoicing, same updates on the
          same day. There is nothing to install beyond a browser and nothing to buy beyond an
          optional printer.
        </p>
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto w-full max-w-3xl px-6 py-16">
          <h2 className="text-[clamp(1.5rem,3.5vw,2rem)] font-semibold tracking-tight text-foreground">
            What you get, wherever you are
          </h2>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <Link href="/pos-billing-software" className="rounded-xl border border-border bg-background p-5 hover:border-border-strong">
              <p className="text-sm font-medium text-foreground">POS &amp; billing</p>
              <p className="mt-1 text-[13px] text-muted-foreground">One-screen billing, KOT, tables.</p>
            </Link>
            <Link href="/gst-billing-software-for-restaurants" className="rounded-xl border border-border bg-background p-5 hover:border-border-strong">
              <p className="text-sm font-medium text-foreground">GST billing</p>
              <p className="mt-1 text-[13px] text-muted-foreground">Correct tax invoice, every bill.</p>
            </Link>
            <Link href="/qr-code-ordering-system" className="rounded-xl border border-border bg-background p-5 hover:border-border-strong">
              <p className="text-sm font-medium text-foreground">QR ordering</p>
              <p className="mt-1 text-[13px] text-muted-foreground">Guests order from their phone.</p>
            </Link>
            <Link href="/restaurant-inventory-management-software" className="rounded-xl border border-border bg-background p-5 hover:border-border-strong">
              <p className="text-sm font-medium text-foreground">Inventory &amp; recipes</p>
              <p className="mt-1 text-[13px] text-muted-foreground">Stock that deducts itself.</p>
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-3xl px-6 py-16">
        <h2 className="text-[clamp(1.5rem,3.5vw,2rem)] font-semibold tracking-tight text-foreground">
          Questions from café owners in {c.name}
        </h2>
        <div className="mt-10 divide-y divide-border border-t border-border">
          {c.faqs.map((f) => (
            <div key={f.q} className="py-5">
              <h3 className="text-[15px] font-medium text-foreground">{f.q}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{f.a}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-border bg-surface">
        <div className="mx-auto w-full max-w-3xl px-6 py-16 text-center">
          <h2 className="text-[clamp(1.35rem,3vw,1.9rem)] font-semibold tracking-tight text-foreground">
            Try it before you pay for it.
          </h2>
          <p className="mx-auto mt-3 max-w-md text-[15px] text-muted-foreground">
            Set up your menu, print a test bill, and decide afterwards.
          </p>
          <Link href="/get-started" className="mt-7 inline-block"><Button size="lg">Start free</Button></Link>
          <p className="mt-8 text-[13.5px] text-muted-foreground">
            Also serving{' '}
            {CITIES.filter((o) => o.slug !== c.slug).map((o, i, arr) => (
              <span key={o.slug}>
                <Link href={`/restaurant-pos-software/${o.slug}`} className="font-medium text-primary hover:underline">
                  {o.name}
                </Link>
                {i < arr.length - 1 ? ', ' : ''}
              </span>
            ))}
            .
          </p>
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
