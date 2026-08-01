import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { SiteHeader } from '@/components/marketing/site-header'
import { SiteFooter } from '@/components/marketing/site-footer'

// No official Windows logo in lucide-react — this is the generic four-pane
// flag shape widely used for "Windows" download buttons across the web,
// not Microsoft's trademarked asset.
function WindowsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 88 88" fill="currentColor" className={className} aria-hidden>
      <rect x="0" y="0" width="40" height="40" />
      <rect x="48" y="0" width="40" height="40" />
      <rect x="0" y="48" width="40" height="40" />
      <rect x="48" y="48" width="40" height="40" />
    </svg>
  )
}

// lucide-react's "Apple" icon is a loose outline, not the recognizable
// silhouette — this is the actual bitten-apple mark shape.
function AppleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zm3.53-3.257c.843-1.026 1.4-2.454 1.245-3.874-1.207.052-2.662.805-3.532 1.831-.78.907-1.454 2.36-1.273 3.75 1.36.104 2.715-.688 3.56-1.707z" />
    </svg>
  )
}

const features = [
  {
    title: 'Point of sale',
    body: 'A fast, keyboard-friendly POS your staff learn in a shift. Variants, add-ons, discounts, split payments — no lag at the counter.',
  },
  {
    title: 'QR ordering',
    body: 'Guests scan, browse, and order from their table. No app to install, no login to force. Orders land straight in the kitchen.',
  },
  {
    title: 'Digital menu',
    body: 'One menu, always current. Mark an item sold out and it updates everywhere instantly — counter, QR, and kitchen alike.',
  },
  {
    title: 'Customer CRM',
    body: 'Every order quietly builds a customer profile — visits, spend, favourites — so you know your regulars without asking.',
  },
  {
    title: 'Loyalty',
    body: 'Points that actually bring people back, on rules you set. Balances come from an immutable ledger, never a number you can fat-finger.',
  },
  {
    title: 'Analytics',
    body: "Today's sales, average order value, peak hours, best sellers. The numbers an owner checks at 11pm, on their phone.",
  },
]

const steps = [
  ['Register your café', 'Create your account and workspace in under two minutes.'],
  ['Set up your menu', 'Add items, prices, and categories — or import what you have.'],
  ['Generate your QR', 'Every table gets a QR code, ready to print and place.'],
  ['Start taking orders', 'Counter, table, or takeaway — all in one live queue.'],
  ['Build loyalty', 'Turn first visits into regulars with points and offers.'],
]

const faqs = [
  {
    q: 'What is KhaoPiyo?',
    a: 'KhaoPiyo is a cloud POS and café operations platform — billing, QR ordering, digital menus, kitchen display (KOT/KDS), customer CRM, loyalty and analytics in one connected system, built for cafés, cloud kitchens and casual-dining restaurants in India.',
  },
  {
    q: 'Who makes KhaoPiyo?',
    a: 'KhaoPiyo is built by Ventron, a technology company based in Hisar, Haryana, India, founded by Vineet Sharma.',
  },
  {
    q: 'Who is KhaoPiyo for?',
    a: 'Independent cafés, small restaurant chains, and takeaway or cloud kitchens in India that want one system for billing, ordering and operations instead of a bill book, a spreadsheet, and a separate ordering app.',
  },
  {
    q: 'How much does KhaoPiyo cost?',
    a: 'Flat monthly plans: Starter at ₹999, Growth at ₹2,499, and Scale at ₹4,999 — shown upfront, with no hardware to buy and no separate setup fee.',
  },
  {
    q: 'Is there a free trial?',
    a: 'Yes — sign up and set up your café for free; you only move to a paid plan once you\'re ready.',
  },
  {
    q: 'Is KhaoPiyo actually live, or still in development?',
    a: 'It\'s live. KhaoPiyo\'s first café is Brewora Café in Hisar, Haryana, running real day-to-day billing, QR ordering, and GST invoicing.',
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

export default function Home() {
  return (
    <div className="flex w-full min-h-dvh flex-col bg-background">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <SiteHeader />

      {/* Hero */}
      <section className="mx-auto grid w-full max-w-6xl gap-12 px-6 py-16 md:grid-cols-2 md:items-center md:py-24">
        <div className="min-w-0">
          <span className="inline-flex items-center rounded-full border border-border bg-surface px-3 py-1 text-[12px] font-medium text-muted-foreground">
            Built for Indian cafés
          </span>
          <h1 className="mt-5 text-[clamp(2.5rem,6vw,4rem)] font-semibold leading-[1.05] tracking-tight text-foreground">
            Run your café smarter.
          </h1>
          <p className="mt-5 max-w-md text-[17px] leading-relaxed text-muted-foreground">
            POS, QR ordering, customer loyalty, CRM, and café operations — all in one calm, fast
            platform. Take your first order today.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/get-started">
              <Button size="lg">Start free</Button>
            </Link>
            <a href="#how">
              <Button variant="secondary" size="lg">See how it works</Button>
            </a>
          </div>
          <p className="mt-4 text-[13px] text-muted-foreground">
            No card required · Your data stays yours
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            <a
              href="/downloads/KhaoPiyo-Setup.exe"
              download
              className="inline-flex h-11 items-center gap-2 rounded-[var(--radius)] border border-border-strong bg-surface px-4 text-[13px] font-medium text-foreground transition-colors hover:bg-surface-subtle"
            >
              <WindowsIcon className="h-4 w-4" />
              Download for Windows
            </a>
            <a
              href="/downloads/KhaoPiyo.dmg"
              download
              className="inline-flex h-11 items-center gap-2 rounded-[var(--radius)] border border-border-strong bg-surface px-4 text-[13px] font-medium text-foreground transition-colors hover:bg-surface-subtle"
            >
              <AppleIcon className="h-4 w-4" />
              Download for Mac
            </a>
          </div>
        </div>

        {/* Real product mock — a live-orders board, not a stock illustration */}
        <div className="min-w-0 rounded-2xl border border-border bg-surface p-3 shadow-sm">
          <div className="rounded-xl bg-surface-subtle p-4">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-medium text-foreground">Live orders</p>
              <span className="inline-flex items-center gap-1.5 text-[12px] text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success" /> 3 active
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {[
                { n: '12', t: 'Table 4', items: 'Cappuccino · Brownie', amt: '₹200', s: 'Preparing', c: 'warning' },
                { n: '13', t: 'Table 1', items: 'Cold Coffee × 2', amt: '₹360', s: 'Ready', c: 'success' },
                { n: '14', t: 'Takeaway', items: 'Latte · Sandwich', amt: '₹310', s: 'New', c: 'info' },
              ].map((o) => (
                <div key={o.n} className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary-subtle text-sm font-semibold text-primary">
                    {o.n}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-foreground">{o.t}</p>
                    <p className="truncate text-[12px] text-muted-foreground">{o.items}</p>
                  </div>
                  <span className="text-[13px] font-medium text-foreground">{o.amt}</span>
                  <span
                    className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                    style={{
                      background: `var(--${o.c}-subtle)`,
                      color: `var(--${o.c})`,
                    }}
                  >
                    {o.s}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {[
                ['Today', '₹18,240'],
                ['Orders', '86'],
                ['Avg order', '₹212'],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg border border-border bg-surface px-3 py-2.5">
                  <p className="text-[11px] text-muted-foreground">{k}</p>
                  <p className="mt-0.5 text-[15px] font-semibold text-foreground">{v}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Value strip */}
      <section className="border-y border-border bg-surface">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-6 py-10 md:grid-cols-4">
          {[
            ['Faster orders', 'Less time at the counter'],
            ['Better retention', 'Regulars, not just footfall'],
            ['Simpler operations', 'One system, not five tabs'],
            ['Real insight', 'Know your numbers daily'],
          ].map(([h, s]) => (
            <div key={h}>
              <p className="text-sm font-medium text-foreground">{h}</p>
              <p className="mt-1 text-[13px] text-muted-foreground">{s}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto w-full max-w-6xl px-6 py-20">
        <h2 className="max-w-xl text-[clamp(1.75rem,4vw,2.5rem)] font-semibold tracking-tight text-foreground">
          Everything your café needs, nothing it doesn&apos;t.
        </h2>
        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="bg-surface p-6">
              <h3 className="text-base font-medium text-foreground">{f.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-y border-border bg-surface">
        <div className="mx-auto w-full max-w-6xl px-6 py-20">
          <h2 className="text-[clamp(1.75rem,4vw,2.5rem)] font-semibold tracking-tight text-foreground">
            Live in an afternoon.
          </h2>
          <ol className="mt-12 grid gap-8 md:grid-cols-5">
            {steps.map(([title, body], i) => (
              <li key={title}>
                <span className="grid h-8 w-8 place-items-center rounded-full border border-border-strong text-sm font-semibold text-foreground">
                  {i + 1}
                </span>
                <p className="mt-3 text-sm font-medium text-foreground">{title}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Pricing teaser */}
      <section id="pricing" className="mx-auto w-full max-w-6xl px-6 py-20 text-center">
        <h2 className="text-[clamp(1.75rem,4vw,2.5rem)] font-semibold tracking-tight text-foreground">
          Ready to modernize your café?
        </h2>
        <p className="mx-auto mt-3 max-w-md text-[15px] text-muted-foreground">
          Start free while you set up. Simple monthly pricing once you&apos;re taking orders — no
          lock-in, cancel anytime.
        </p>
        <div className="mt-8">
          <Link href="/get-started">
            <Button size="lg">Start free</Button>
          </Link>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-border bg-surface">
        <div className="mx-auto w-full max-w-3xl px-6 py-20">
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
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
