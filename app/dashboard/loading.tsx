'use client'

// Every dashboard page is `dynamic = 'force-dynamic'` and fetches its own
// data server-side on each navigation — this is the Suspense fallback
// Next.js swaps in the instant a click starts one. It renders BELOW
// layout.tsx/AppShell in the component tree (loading.js only wraps page.js,
// never the layout it sits inside — see Next's own file-convention docs),
// so the sidebar and header stay mounted and interactive the whole time;
// this only ever replaces the <main> content area.
//
// Client component specifically so it can read usePathname() — by the time
// this fallback is showing, the URL has already committed to the
// DESTINATION route (that's what triggered this render in the first
// place), so this can name where it's actually going ("Opening POS…")
// without any hand-off from whatever was clicked.
//
// Deliberately NOT shown for genuinely fast navigations: the outer wrapper
// starts at opacity 0 and only fades in after a short delay (same
// technique Next's own useLinkStatus docs recommend for exactly this) — if
// the destination resolves before that delay elapses, React unmounts this
// before it was ever visible, so a quick hop never flashes a loading screen.
import { usePathname } from 'next/navigation'
import Image from 'next/image'

// Longest-prefix match, same semantics as buildNav's own activeHref() in
// app-shell.tsx (kept as a small, separate list rather than importing from
// there — that file's NavItem also carries icons/feature gating this has no
// use for). '/dashboard' is exact-only for the same reason it is there: a
// bare prefix match would claim every route under it.
const ROUTE_LABELS: { href: string; label: string; exact?: boolean }[] = [
  { href: '/dashboard', label: 'Dashboard', exact: true },
  { href: '/dashboard/pos', label: 'POS' },
  { href: '/dashboard/tables/manage', label: 'QR Codes' },
  { href: '/dashboard/tables', label: 'Live Tables' },
  { href: '/dashboard/bills', label: 'Bills' },
  { href: '/dashboard/shift', label: 'Shift & Cash' },
  { href: '/dashboard/kitchen', label: 'Kitchen' },
  { href: '/dashboard/menu', label: 'Menu' },
  { href: '/dashboard/customers', label: 'Customers' },
  { href: '/dashboard/inventory', label: 'Inventory' },
  { href: '/dashboard/purchases', label: 'Purchases' },
  { href: '/dashboard/recipes', label: 'Recipes & Cost' },
  { href: '/dashboard/coupons', label: 'Coupons & Offers' },
  { href: '/dashboard/loyalty', label: 'Loyalty & Rewards' },
  { href: '/dashboard/spin', label: 'Spin & Win' },
  { href: '/dashboard/wallet', label: 'Wallet' },
  { href: '/dashboard/reservations', label: 'Reservations' },
  { href: '/dashboard/analytics', label: 'Analytics' },
  { href: '/dashboard/reports', label: 'Reports' },
  { href: '/dashboard/expenses', label: 'Expenses' },
  { href: '/dashboard/profile', label: 'Café Profile' },
  { href: '/dashboard/billing', label: 'Billing' },
  { href: '/dashboard/settings', label: 'Settings' },
].sort((a, b) => b.href.length - a.href.length)

function labelFor(pathname: string): string {
  const match = ROUTE_LABELS.find((r) => (r.exact ? pathname === r.href : pathname === r.href || pathname.startsWith(r.href + '/')))
  return match?.label ?? 'your café'
}

export default function DashboardLoading() {
  const pathname = usePathname()
  const label = labelFor(pathname)

  return (
    <div className="grid min-h-[70dvh] place-items-center px-6">
      <div className="kp-loading-in flex flex-col items-center gap-5">
        <div className="relative grid h-16 w-16 place-items-center">
          <div className="kp-loading-breathe absolute inset-0 rounded-2xl bg-primary/10" />
          <Image src="/logo-mark.png" alt="" width={40} height={40} className="relative h-10 w-10" priority />
        </div>
        <p className="text-[13.5px] font-medium text-foreground">
          Opening {label}
          <span className="inline-flex w-[1.5em] justify-start">
            <span className="kp-loading-dot" style={{ animationDelay: '0ms' }}>.</span>
            <span className="kp-loading-dot" style={{ animationDelay: '200ms' }}>.</span>
            <span className="kp-loading-dot" style={{ animationDelay: '400ms' }}>.</span>
          </span>
        </p>
      </div>
      <style>{`
        .kp-loading-in {
          opacity: 0;
          animation: kp-loading-fade-in 180ms ease-out 160ms forwards;
        }
        .kp-loading-breathe {
          animation: kp-loading-breathe 2s ease-in-out infinite;
        }
        .kp-loading-dot {
          display: inline-block;
          animation: kp-loading-dot 1.4s ease-in-out infinite;
        }
        @keyframes kp-loading-fade-in { to { opacity: 1; } }
        @keyframes kp-loading-breathe {
          0%, 100% { transform: scale(1); opacity: 0.7; }
          50% { transform: scale(1.08); opacity: 1; }
        }
        @keyframes kp-loading-dot {
          0%, 60%, 100% { opacity: 0.25; }
          30% { opacity: 1; }
        }
      `}</style>
    </div>
  )
}
