'use client'

import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, ShoppingCart, Grid2x2, ReceiptText, ChefHat, Banknote,
  BookOpenText, Users, ChartBar, Wallet, Package, Soup,
  Store, QrCode, Settings as SettingsIcon,
  PanelLeftClose, PanelLeft, CircleHelp, ChevronDown, LogOut, Menu as MenuIcon,
} from 'lucide-react'
import type { CafeOption } from '@/lib/cafe'
import { CafeSwitcher } from '@/components/cafe-switcher'
import { NotificationBell } from '@/components/notification-bell'

type NavItem = { label: string; href: string; icon: React.ReactNode; badge?: string }
type NavGroup = { heading: string; items: NavItem[] }

const ICON = 17

function buildNav(cashEnabled: boolean): NavGroup[] {
  const overview: NavItem[] = [
    { label: 'Dashboard', href: '/dashboard', icon: <LayoutDashboard size={ICON} /> },
    { label: 'POS', href: '/dashboard/pos', icon: <ShoppingCart size={ICON} /> },
    { label: 'Live tables', href: '/dashboard/tables', icon: <Grid2x2 size={ICON} /> },
    { label: 'Bills', href: '/dashboard/bills', icon: <ReceiptText size={ICON} />, badge: 'New' },
    ...(cashEnabled ? [{ label: 'Shift & cash', href: '/dashboard/shift', icon: <Banknote size={ICON} /> }] : []),
    { label: 'Kitchen', href: '/dashboard/kitchen', icon: <ChefHat size={ICON} /> },
  ]
  return [
    { heading: 'Operations', items: overview },
    {
      heading: 'Management',
      items: [
        { label: 'Menu', href: '/dashboard/menu', icon: <BookOpenText size={ICON} /> },
        { label: 'Customers', href: '/dashboard/customers', icon: <Users size={ICON} /> },
        { label: 'Inventory', href: '/dashboard/inventory', icon: <Package size={ICON} /> },
        { label: 'Recipes & cost', href: '/dashboard/recipes', icon: <Soup size={ICON} /> },
        { label: 'Reports', href: '/dashboard/reports', icon: <ChartBar size={ICON} /> },
        { label: 'Expenses', href: '/dashboard/expenses', icon: <Wallet size={ICON} /> },
      ],
    },
    {
      heading: 'Business',
      items: [
        { label: 'Café profile', href: '/dashboard/profile', icon: <Store size={ICON} /> },
        { label: 'QR codes', href: '/dashboard/tables/manage', icon: <QrCode size={ICON} /> },
        { label: 'Settings', href: '/dashboard/settings', icon: <SettingsIcon size={ICON} /> },
      ],
    },
  ]
}

// Longest matching href wins, so /dashboard/tables/manage highlights "QR codes"
// and not also "Live tables". /dashboard is exact-only so it isn't always on.
function activeHref(pathname: string, groups: NavGroup[]): string {
  const hrefs = groups.flatMap((g) => g.items.map((i) => i.href))
  const matches = hrefs.filter(
    (h) => pathname === h || (h !== '/dashboard' && pathname.startsWith(h + '/')),
  )
  return matches.sort((a, b) => b.length - a.length)[0] ?? ''
}

export function AppShell({
  cafeName,
  cafeId,
  role,
  timezone,
  cashEnabled,
  cafes,
  canAddCafe,
  userName,
  children,
}: {
  cafeName: string
  cafeId: string
  role: string
  timezone: string
  cashEnabled: boolean
  cafes: CafeOption[]
  canAddCafe: boolean
  userName: string
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const groups = useMemo(() => buildNav(cashEnabled), [cashEnabled])
  const active = activeHref(pathname, groups)

  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)

  useEffect(() => {
    // Read the saved preference AFTER mount — localStorage isn't available
    // during SSR, so a lazy initial value would mismatch on hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsed(localStorage.getItem('kp_sidebar_collapsed') === '1')
  }, [])
  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c
      localStorage.setItem('kp_sidebar_collapsed', next ? '1' : '0')
      return next
    })
  }
  // Close the mobile drawer when the route changes (an external system).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMobileOpen(false) }, [pathname])

  const railWidth = collapsed ? 'lg:w-[68px]' : 'lg:w-64'

  const rail = (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Brand */}
      <div className={`flex items-center gap-2.5 px-4 py-4 ${collapsed ? 'lg:justify-center lg:px-0' : ''}`}>
        <Image src="/logo-mark.png" alt="" width={36} height={36} className="h-9 w-9 shrink-0" priority />
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-[15px] font-semibold leading-tight tracking-tight">KhaoPiyo</p>
            <p className="truncate text-[11.5px] text-sidebar-muted">{cafeName}</p>
          </div>
        )}
      </div>

      {!collapsed && (cafes.length > 1 || canAddCafe) && (
        <div className="px-3 pb-1">
          <CafeSwitcher cafes={cafes} activeCafeId={cafeId} canAddCafe={canAddCafe} />
        </div>
      )}

      <nav className="flex-1 overflow-y-auto px-3 py-2">
        {groups.map((group) => (
          <div key={group.heading} className="mb-4 last:mb-0">
            {!collapsed && (
              <p className="px-2.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-sidebar-muted">
                {group.heading}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const on = item.href === active
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      aria-current={on ? 'page' : undefined}
                      className={`group relative flex items-center rounded-[var(--radius)] text-[13.5px] font-medium transition-colors ${
                        collapsed ? 'lg:justify-center lg:px-0 lg:py-2.5' : 'gap-2.5 px-2.5 py-2'
                      } ${
                        on
                          ? 'bg-sidebar-active text-sidebar-active-foreground'
                          : 'text-sidebar-foreground/85 hover:bg-sidebar-hover hover:text-sidebar-foreground'
                      }`}
                    >
                      {on && !collapsed && (
                        <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-accent" />
                      )}
                      <span className={on ? 'text-sidebar-active-foreground' : 'text-sidebar-muted group-hover:text-sidebar-foreground'}>
                        {item.icon}
                      </span>
                      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                      {!collapsed && item.badge && (
                        <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Collapse toggle (desktop only) */}
      <div className="hidden border-t border-sidebar-border p-2 lg:block">
        <button
          onClick={toggleCollapsed}
          className={`flex w-full items-center gap-2.5 rounded-[var(--radius)] px-2.5 py-2 text-[12.5px] font-medium text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-sidebar-foreground ${collapsed ? 'justify-center px-0' : ''}`}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? <PanelLeft size={16} /> : <><PanelLeftClose size={16} /> Collapse</>}
        </button>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-dvh w-full bg-background">
      {/* Desktop sidebar */}
      <aside className={`sticky top-0 hidden h-dvh shrink-0 lg:block ${railWidth} transition-[width] duration-200`}>
        {rail}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-72 max-w-[82vw]">{rail}</div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top utility bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-surface/85 px-3 backdrop-blur sm:px-5">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="grid h-10 w-10 place-items-center rounded-[var(--radius)] text-muted-foreground hover:bg-surface-subtle lg:hidden"
          >
            <MenuIcon size={19} />
          </button>

          <div className="flex items-center gap-2 lg:hidden">
            <Image src="/logo-mark.png" alt="" width={26} height={26} className="h-[26px] w-[26px]" />
            <span className="font-semibold tracking-tight text-foreground">KhaoPiyo</span>
          </div>

          <div className="ml-auto flex items-center gap-1">
            <a
              href="mailto:support@khaopiyo.app"
              className="hidden h-10 items-center gap-1.5 rounded-[var(--radius)] px-3 text-[13px] font-medium text-muted-foreground hover:bg-surface-subtle sm:inline-flex"
            >
              <CircleHelp size={16} /> Help
            </a>
            <NotificationBell cafeId={cafeId} timezone={timezone} />

            <div className="relative">
              <button
                onClick={() => setAccountOpen((v) => !v)}
                className="flex h-10 items-center gap-2 rounded-[var(--radius)] px-2 hover:bg-surface-subtle"
              >
                <span className="grid h-8 w-8 place-items-center rounded-full bg-primary-subtle text-[13px] font-semibold text-primary">
                  {(userName || 'U').charAt(0).toUpperCase()}
                </span>
                <span className="hidden text-left sm:block">
                  <span className="block text-[12.5px] font-medium leading-tight text-foreground">{userName || 'Account'}</span>
                  <span className="block text-[11px] capitalize leading-tight text-muted-foreground">{role}</span>
                </span>
                <ChevronDown size={15} className="hidden text-muted-foreground sm:block" />
              </button>
              {accountOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setAccountOpen(false)} />
                  <div className="absolute right-0 top-12 z-50 w-52 rounded-[var(--radius-lg)] border border-border bg-surface p-1.5 shadow-[var(--shadow-lg)]">
                    <div className="px-2.5 py-2">
                      <p className="text-[13px] font-medium text-foreground">{userName || 'Account'}</p>
                      <p className="text-[11.5px] capitalize text-muted-foreground">{role} · {cafeName}</p>
                    </div>
                    <div className="my-1 h-px bg-border" />
                    <Link href="/dashboard/profile" onClick={() => setAccountOpen(false)}
                      className="flex items-center gap-2 rounded-[var(--radius)] px-2.5 py-2 text-[13px] text-foreground hover:bg-surface-subtle">
                      <Store size={15} /> Café profile
                    </Link>
                    <Link href="/dashboard/settings" onClick={() => setAccountOpen(false)}
                      className="flex items-center gap-2 rounded-[var(--radius)] px-2.5 py-2 text-[13px] text-foreground hover:bg-surface-subtle">
                      <SettingsIcon size={15} /> Settings
                    </Link>
                    <div className="my-1 h-px bg-border" />
                    <form action="/auth/signout" method="post">
                      <button className="flex w-full items-center gap-2 rounded-[var(--radius)] px-2.5 py-2 text-left text-[13px] text-destructive hover:bg-destructive-subtle">
                        <LogOut size={15} /> Sign out
                      </button>
                    </form>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  )
}
