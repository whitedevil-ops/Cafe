'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Reveal } from './reveal'
import { LaptopFrame, TabletFrame, PhoneFrame } from './device-frame'

// Every panel below is a hand-built recreation using the site's own real
// design tokens and layout patterns — not a generic illustration, and not a
// literal screenshot either (that would need an authenticated dashboard
// session in the browser, which this project deliberately never types
// credentials into, even disposable ones). Same honest-recreation approach
// the homepage's own "Live orders" hero card has always used.

const KOT_COLUMNS = [
  { label: 'New', tone: 'info', tickets: ['#14 · Takeaway', '#17 · Table 6'] },
  { label: 'Preparing', tone: 'warning', tickets: ['#12 · Table 4', '#15 · Table 2', '#16 · Table 9'] },
  { label: 'Ready', tone: 'success', tickets: ['#13 · Table 1'] },
] as const

const TABLES = [
  { n: 1, s: 'Occupied', tone: 'warning' },
  { n: 2, s: 'Occupied', tone: 'warning' },
  { n: 3, s: 'Free', tone: 'muted' },
  { n: 4, s: 'Bill due', tone: 'destructive' },
  { n: 5, s: 'Free', tone: 'muted' },
  { n: 6, s: 'Occupied', tone: 'warning' },
] as const

const MENU_ITEMS = [
  { name: 'Cappuccino', price: '₹140' },
  { name: 'Cold Brew', price: '₹160' },
  { name: 'Veg Sandwich', price: '₹180' },
  { name: 'Brownie', price: '₹120' },
] as const

const REPORT_KPIS = [
  ['Revenue', '₹18,240'],
  ['Orders', '86'],
  ['Avg order', '₹212'],
] as const

const PANELS = [
  {
    key: 'pos',
    label: 'Desktop POS',
    frame: 'laptop' as const,
    content: (
      <div className="flex h-64 text-[11px]">
        <div className="flex-1 border-r border-border p-3">
          <div className="flex gap-1.5">
            {['Coffee', 'Food', 'Desserts'].map((c, i) => (
              <span key={c} className={`rounded-full px-2.5 py-1 font-medium ${i === 0 ? 'bg-primary text-primary-foreground' : 'bg-surface-subtle text-muted-foreground'}`}>{c}</span>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {MENU_ITEMS.map((m) => (
              <div key={m.name} className="rounded-lg border border-border bg-surface p-2">
                <div className="h-8 rounded bg-primary-subtle" />
                <p className="mt-1.5 truncate font-medium text-foreground">{m.name}</p>
                <p className="text-muted-foreground">{m.price}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="w-32 p-3">
          <p className="font-medium text-foreground">Table 4</p>
          <div className="mt-2 space-y-1.5 text-muted-foreground">
            <p className="flex justify-between"><span>Cappuccino</span><span>₹140</span></p>
            <p className="flex justify-between"><span>Brownie</span><span>₹120</span></p>
          </div>
          <div className="mt-3 border-t border-border pt-2 font-medium text-foreground">
            <p className="flex justify-between"><span>Total</span><span>₹260</span></p>
          </div>
          <div className="mt-2 rounded-md bg-primary py-1.5 text-center font-medium text-primary-foreground">Pay</div>
        </div>
      </div>
    ),
  },
  {
    key: 'tables',
    label: 'Live Tables',
    frame: 'tablet' as const,
    content: (
      <div className="grid grid-cols-3 gap-2.5 p-4 text-[11px]">
        {TABLES.map((t) => (
          <div key={t.n} className="rounded-xl border border-border bg-surface p-3 text-center">
            <p className="text-[15px] font-semibold text-foreground">T{t.n}</p>
            <span
              className="mt-1.5 inline-block rounded-full px-2 py-0.5 font-medium"
              style={{ background: `var(--${t.tone}-subtle)`, color: `var(--${t.tone})` }}
            >
              {t.s}
            </span>
          </div>
        ))}
      </div>
    ),
  },
  {
    key: 'menu',
    label: 'Customer QR Ordering',
    frame: 'phone' as const,
    content: (
      <div className="h-72 overflow-hidden pt-8 text-[11px]">
        <div className="border-b border-border px-3 pb-2">
          <p className="font-medium text-foreground">Brewora Café</p>
          <p className="text-muted-foreground">Table 4</p>
        </div>
        <div className="space-y-2 p-3">
          {MENU_ITEMS.map((m) => (
            <div key={m.name} className="flex items-center gap-2.5 rounded-lg border border-border bg-surface p-2">
              <div className="h-8 w-8 shrink-0 rounded-md bg-primary-subtle" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{m.name}</p>
                <p className="text-muted-foreground">{m.price}</p>
              </div>
              <span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground">+</span>
            </div>
          ))}
        </div>
        <div className="absolute inset-x-3 bottom-3 rounded-lg bg-primary py-2 text-center font-medium text-primary-foreground">
          View cart · ₹260
        </div>
      </div>
    ),
  },
  {
    key: 'kds',
    label: 'Kitchen Display',
    frame: 'laptop' as const,
    content: (
      <div className="grid h-64 grid-cols-3 gap-px bg-border text-[11px]">
        {KOT_COLUMNS.map((col) => (
          <div key={col.label} className="bg-surface p-2.5">
            <p className="font-medium" style={{ color: `var(--${col.tone})` }}>{col.label}</p>
            <div className="mt-2 space-y-1.5">
              {col.tickets.map((t) => (
                <div key={t} className="rounded-md border border-border bg-surface-subtle p-2 text-foreground">{t}</div>
              ))}
            </div>
          </div>
        ))}
      </div>
    ),
  },
  {
    key: 'reports',
    label: 'Reports Dashboard',
    frame: 'laptop' as const,
    content: (
      <div className="h-64 p-4 text-[11px]">
        <div className="grid grid-cols-3 gap-2.5">
          {REPORT_KPIS.map(([k, v]) => (
            <div key={k} className="rounded-lg border border-border bg-surface-subtle p-2.5">
              <p className="text-muted-foreground">{k}</p>
              <p className="mt-0.5 text-[14px] font-semibold text-foreground">{v}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 flex h-24 items-end gap-1.5 rounded-lg border border-border p-3">
          {[8, 14, 10, 18, 13, 20, 16].map((h, i) => (
            <span key={i} className="flex-1 rounded-sm bg-primary/70" style={{ height: `${h * 4}px` }} />
          ))}
        </div>
      </div>
    ),
  },
  {
    key: 'my-orders',
    label: 'Phone Ordering',
    frame: 'phone' as const,
    content: (
      <div className="h-72 pt-8 text-[11px]">
        <div className="border-b border-border px-3 pb-2">
          <p className="font-medium text-foreground">My Orders</p>
        </div>
        <div className="p-3">
          <div className="rounded-lg border border-border bg-surface p-3">
            <p className="flex justify-between font-medium text-foreground"><span>Order #14</span><span>₹310</span></p>
            <p className="mt-0.5 text-muted-foreground">Latte · Sandwich</p>
            <div className="mt-3 flex items-center gap-1.5">
              {['New', 'Preparing', 'Ready', 'Served'].map((s, i) => (
                <div key={s} className="flex flex-1 items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${i <= 1 ? 'bg-primary' : 'bg-border-strong'}`} />
                  {i < 3 && <span className={`h-px flex-1 ${i < 1 ? 'bg-primary' : 'bg-border-strong'}`} />}
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-muted-foreground">Preparing your order…</p>
          </div>
        </div>
      </div>
    ),
  },
] as const

const FRAMES = { laptop: LaptopFrame, tablet: TabletFrame, phone: PhoneFrame }

export function ProductShowcase() {
  const [active, setActive] = useState(0)
  const panel = PANELS[active]
  const Frame = FRAMES[panel.frame]

  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-20">
      <Reveal>
        <h2 className="font-display max-w-xl text-[clamp(1.85rem,4vw,2.75rem)] font-semibold tracking-tight text-foreground">
          One system, every screen.
        </h2>
        <p className="mt-3 max-w-lg text-[15px] text-muted-foreground">
          The same real product — on the counter, in the kitchen, and in your guest&apos;s pocket.
        </p>
      </Reveal>

      <Reveal delay={0.1}>
        <div className="mt-8 flex flex-wrap gap-2">
          {PANELS.map((p, i) => (
            <button
              key={p.key}
              onClick={() => setActive(i)}
              className={`rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                active === i ? 'border-primary bg-primary-subtle text-primary' : 'border-border-strong text-muted-foreground hover:bg-surface-subtle'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Reveal>

      <div className="relative mt-10 min-h-[22rem]">
        <AnimatePresence mode="wait">
          <motion.div
            key={panel.key}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          >
            <Frame>{panel.content}</Frame>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  )
}
