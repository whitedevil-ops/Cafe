import Image from 'next/image'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

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

export default function Home() {
  return (
    <div className="flex w-full min-h-dvh flex-col bg-background">
      {/* Nav */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center">
            <Image src="/logo-wordmark.png" alt="KhaoPiyo" width={900} height={311} className="h-8 w-auto" priority />
          </Link>
          <div className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
            <a href="#features" className="transition-colors hover:text-foreground">Features</a>
            <a href="#how" className="transition-colors hover:text-foreground">How it works</a>
            <a href="#pricing" className="transition-colors hover:text-foreground">Pricing</a>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login">
              <Button variant="ghost" size="sm">Log in</Button>
            </Link>
            <Link href="/signup">
              <Button size="sm">Start free</Button>
            </Link>
          </div>
        </nav>
      </header>

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
            <Link href="/signup">
              <Button size="lg">Start free</Button>
            </Link>
            <a href="#how">
              <Button variant="secondary" size="lg">See how it works</Button>
            </a>
          </div>
          <p className="mt-4 text-[13px] text-muted-foreground">
            No card required · Your data stays yours
          </p>
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
          <Link href="/signup">
            <Button size="lg">Start free</Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t border-border bg-surface">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-lg font-semibold tracking-tight text-foreground">counter</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              The operating system for modern cafés.
            </p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-muted-foreground">
            <Link href="/legal/privacy" className="hover:text-foreground">Privacy</Link>
            <Link href="/legal/terms" className="hover:text-foreground">Terms</Link>
            <Link href="/legal/cookies" className="hover:text-foreground">Cookies</Link>
            <Link href="/login" className="hover:text-foreground">Log in</Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
