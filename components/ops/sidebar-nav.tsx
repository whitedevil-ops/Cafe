'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Activity,
  ClipboardList,
  LayoutDashboard,
  ScrollText,
  ShieldCheck,
  Store,
  Users,
  type LucideIcon,
} from 'lucide-react'

// The console had seven flat links and no active state at all, so the only way
// to know which screen you were on was to read the heading. This adds the two
// things that fixes: a visible current item, and grouping so the list reads as
// three short sets rather than one long one.

export type NavKey =
  | 'overview'
  | 'cafes'
  | 'health'
  | 'users'
  | 'admins'
  | 'leads'
  | 'audit'

type Item = { key: NavKey; label: string; href: string; icon: LucideIcon }

const GROUPS: { heading: string | null; items: Item[] }[] = [
  {
    heading: null,
    items: [{ key: 'overview', label: 'Overview', href: '/ops', icon: LayoutDashboard }],
  },
  {
    heading: 'Accounts',
    items: [
      { key: 'cafes', label: 'Cafés', href: '/ops/cafes', icon: Store },
      { key: 'users', label: 'Users', href: '/ops/users', icon: Users },
      { key: 'leads', label: 'Leads', href: '/ops/leads', icon: ClipboardList },
    ],
  },
  {
    heading: 'Monitoring',
    items: [
      { key: 'health', label: 'Café health', href: '/ops/health', icon: Activity },
      { key: 'audit', label: 'Audit logs', href: '/ops/audit-logs', icon: ScrollText },
    ],
  },
  {
    heading: 'Console',
    items: [{ key: 'admins', label: 'Admins', href: '/ops/admins', icon: ShieldCheck }],
  },
]

/**
 * Overview lives at the console root, so a plain `startsWith` would mark it
 * active on every single page. It alone needs an exact match.
 *
 * Exported for tests — it is the only real logic in this file and getting it
 * wrong means two items light up at once, or none do.
 */
export function isActive(pathname: string, href: string): boolean {
  return href === '/ops' ? pathname === href : pathname.startsWith(href)
}

export function SidebarNav({ allowed, onNavigate }: { allowed: NavKey[]; onNavigate?: () => void }) {
  const pathname = usePathname()
  const permitted = new Set(allowed)

  return (
    <nav className="space-y-5">
      {GROUPS.map((group) => {
        const items = group.items.filter((i) => permitted.has(i.key))
        // A group whose every item is hidden by permissions must not leave its
        // heading behind pointing at nothing.
        if (items.length === 0) return null

        return (
          <div key={group.heading ?? 'root'}>
            {group.heading && (
              <p className="px-3 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-white/35">
                {group.heading}
              </p>
            )}
            <div className="space-y-0.5">
              {items.map(({ key, label, href, icon: Icon }) => {
                const active = isActive(pathname, href)
                return (
                  <Link
                    key={key}
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center gap-2.5 rounded-[var(--radius-sm)] px-3 py-2 text-[13.5px] transition-colors ${
                      active
                        ? 'bg-amber-500/15 font-medium text-amber-300'
                        : 'text-white/55 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <Icon size={15} className="shrink-0" />
                    {label}
                  </Link>
                )
              })}
            </div>
          </div>
        )
      })}
    </nav>
  )
}
