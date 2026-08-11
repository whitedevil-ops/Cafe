'use client'

import { useRef } from 'react'
import Link from 'next/link'
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from 'motion/react'
import { Button } from '@/components/ui/button'
import { Reveal } from './reveal'
import { CoffeeCupIcon, PizzaSliceIcon, BurgerIcon, DessertIcon, ColdDrinkIcon } from './food-icons'

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

const LIVE_ORDERS = [
  { n: '12', t: 'Table 4', items: 'Cappuccino · Brownie', amt: '₹200', s: 'Preparing', c: 'warning' },
  { n: '13', t: 'Table 1', items: 'Cold Coffee × 2', amt: '₹360', s: 'Ready', c: 'success' },
  { n: '14', t: 'Takeaway', items: 'Latte · Sandwich', amt: '₹310', s: 'New', c: 'info' },
]

const FOOD_GLYPHS = [
  { Icon: CoffeeCupIcon, top: '4%', left: '2%', size: 44, drift: 10 },
  { Icon: PizzaSliceIcon, top: '68%', left: '0%', size: 38, drift: 8 },
  { Icon: BurgerIcon, top: '2%', left: '92%', size: 40, drift: 9 },
  { Icon: DessertIcon, top: '78%', left: '88%', size: 36, drift: 7 },
  { Icon: ColdDrinkIcon, top: '38%', left: '96%', size: 32, drift: 6 },
]

// Pointer-driven CSS-3D tilt on the main product card — perspective +
// rotateX/Y, not a WebGL scene, so it costs almost nothing on the bundle or
// GPU. Disabled entirely under prefers-reduced-motion.
function TiltCard({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()
  const rawX = useMotionValue(0)
  const rawY = useMotionValue(0)
  const rotateX = useSpring(useTransform(rawY, [-0.5, 0.5], [7, -7]), { stiffness: 200, damping: 20 })
  const rotateY = useSpring(useTransform(rawX, [-0.5, 0.5], [-7, 7]), { stiffness: 200, damping: 20 })

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (reduceMotion || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    rawX.set((e.clientX - rect.left) / rect.width - 0.5)
    rawY.set((e.clientY - rect.top) / rect.height - 0.5)
  }
  function onPointerLeave() {
    rawX.set(0)
    rawY.set(0)
  }

  return (
    <motion.div
      ref={ref}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      style={reduceMotion ? undefined : { rotateX, rotateY, transformPerspective: 1000 }}
      className="relative"
    >
      {children}
    </motion.div>
  )
}

function FloatingChip({
  className,
  delay = 0,
  children,
}: {
  className?: string
  delay?: number
  children: React.ReactNode
}) {
  const reduceMotion = useReducedMotion()
  return (
    <motion.div
      className={`absolute rounded-xl border border-border bg-surface p-3 shadow-lg ${className ?? ''}`}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={
        reduceMotion
          ? { opacity: 1, scale: 1 }
          : { opacity: 1, scale: 1, y: [0, -10, 0] }
      }
      transition={
        reduceMotion
          ? { duration: 0.5, delay }
          : { opacity: { duration: 0.5, delay }, scale: { duration: 0.5, delay }, y: { duration: 5, repeat: Infinity, ease: 'easeInOut', delay } }
      }
    >
      {children}
    </motion.div>
  )
}

export function Hero() {
  const reduceMotion = useReducedMotion()

  return (
    <section className="relative overflow-hidden">
      {/* Ambient food glyphs — decorative only, kept out of the text/card columns */}
      <div className="pointer-events-none absolute inset-0 hidden lg:block" aria-hidden>
        {FOOD_GLYPHS.map(({ Icon, top, left, size, drift }, i) => (
          <motion.div
            key={i}
            className="absolute text-primary/[0.09]"
            style={{ top, left, width: size, height: size }}
            animate={reduceMotion ? undefined : { y: [0, -drift, 0], rotate: [0, 4, 0] }}
            transition={reduceMotion ? undefined : { duration: 6 + i, repeat: Infinity, ease: 'easeInOut', delay: i * 0.4 }}
          >
            <Icon className="h-full w-full" />
          </motion.div>
        ))}
      </div>

      <div className="relative mx-auto grid w-full max-w-6xl gap-12 px-6 py-16 md:grid-cols-2 md:items-center md:py-24">
        <div className="min-w-0">
          <Reveal>
            <span className="inline-flex items-center rounded-full border border-border bg-surface px-3 py-1 text-[12px] font-medium text-muted-foreground">
              Built for Indian cafés
            </span>
          </Reveal>
          <Reveal delay={0.05}>
            {/* The strongest on-page signal there is, so it has to say what
                this is as well as sound like something. "Run your café
                smarter" read well and told Google nothing — no POS, no
                billing, no restaurant. This keeps the voice and adds the
                words a café owner actually types. */}
            <h1 className="font-display mt-5 text-[clamp(2.5rem,6vw,4.25rem)] font-semibold leading-[1.05] tracking-tight text-foreground">
              Café and restaurant POS that <span className="text-primary">keeps up.</span>
            </h1>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="mt-5 max-w-md text-[17px] leading-relaxed text-muted-foreground">
              Billing, GST invoices, QR ordering, kitchen display, tables, inventory and loyalty —
              one system for the whole café, running in India. Take your first order today.
            </p>
          </Reveal>
          <Reveal delay={0.15}>
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
          </Reveal>
        </div>

        {/* Real product mock — a live-orders board, not a stock illustration —
            plus a couple of small illustrative satellite chips around it. */}
        <Reveal delay={0.2} y={24}>
          <div className="relative mx-auto max-w-md md:max-w-none" style={{ perspective: 1000 }}>
            <TiltCard>
              <div className="rounded-2xl border border-border bg-surface p-3 shadow-lg">
                <div className="rounded-xl bg-surface-subtle p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-[13px] font-medium text-foreground">Live orders</p>
                    <span className="inline-flex items-center gap-1.5 text-[12px] text-success">
                      <span className="h-1.5 w-1.5 rounded-full bg-success" /> 3 active
                    </span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {LIVE_ORDERS.map((o) => (
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
                          style={{ background: `var(--${o.c}-subtle)`, color: `var(--${o.c})` }}
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
            </TiltCard>

            <FloatingChip className="-left-6 -top-6 hidden w-40 sm:block" delay={0.4}>
              <p className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">Bill generated</p>
              <p className="mt-1 text-[15px] font-semibold text-foreground">₹360.00</p>
              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-success-subtle px-2 py-0.5 text-[10.5px] font-medium text-success">
                Paid
              </span>
            </FloatingChip>

            <FloatingChip className="-right-5 top-1/3 hidden w-36 sm:block" delay={0.6}>
              <p className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">Today&apos;s sales</p>
              <div className="mt-1.5 flex items-end gap-1">
                {[6, 9, 7, 12, 10, 15].map((h, i) => (
                  <span key={i} className="w-2 rounded-sm bg-primary/70" style={{ height: h }} />
                ))}
              </div>
              <span className="mt-1.5 inline-block text-[10.5px] font-medium text-success">↑ 18%</span>
            </FloatingChip>

            <FloatingChip className="bottom-4 -right-4 hidden w-32 sm:block" delay={0.5}>
              <p className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">QR scan</p>
              <p className="mt-1 text-[13px] font-medium text-foreground">Table 7</p>
              <p className="text-[11px] text-muted-foreground">Menu opened</p>
            </FloatingChip>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
