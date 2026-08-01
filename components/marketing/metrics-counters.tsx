import { createAdminClient, adminConfigured } from '@/utils/supabase/admin'
import { Reveal } from './reveal'
import { AnimatedCounter } from './animated-counter'

// Real platform-wide counts, not invented "10,000+" style vanity numbers —
// fetched server-side via the service-role client (never shipped to the
// browser bundle), so this section is small today but never needs a quiet
// fix later as the numbers grow. Server component: no 'use client' here,
// only the individual counter digits animate.
async function getRealCounts() {
  const fallback = { orders: 0, tables: 0, customers: 0, menuItems: 0 }
  if (!adminConfigured()) return fallback
  try {
    const admin = createAdminClient()
    const [orders, tables, customers, menuItems] = await Promise.all([
      admin.from('orders').select('id', { count: 'exact', head: true }).neq('status', 'cancelled'),
      admin.from('cafe_tables').select('id', { count: 'exact', head: true }),
      admin.from('customers').select('id', { count: 'exact', head: true }),
      admin.from('menu_items').select('id', { count: 'exact', head: true }),
    ])
    return {
      orders: orders.count ?? 0,
      tables: tables.count ?? 0,
      customers: customers.count ?? 0,
      menuItems: menuItems.count ?? 0,
    }
  } catch {
    return fallback
  }
}

export async function MetricsCounters() {
  const counts = await getRealCounts()

  const stats = [
    { label: 'Orders processed', value: counts.orders },
    { label: 'Tables managed', value: counts.tables },
    { label: 'Customers tracked', value: counts.customers },
    { label: 'Menu items managed', value: counts.menuItems },
  ]

  return (
    <section className="border-y border-border bg-surface">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-6 py-14 md:grid-cols-4">
        {stats.map((s, i) => (
          <Reveal key={s.label} delay={i * 0.06} className="text-center md:text-left">
            <p className="font-display text-[clamp(1.75rem,4vw,2.5rem)] font-semibold tracking-tight text-primary">
              <AnimatedCounter value={s.value} suffix="+" />
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">{s.label}</p>
          </Reveal>
        ))}
      </div>
      <p className="pb-6 text-center text-[11.5px] text-muted-foreground">
        Real numbers from KhaoPiyo&apos;s live pilot — updated as more cafés come on board.
      </p>
    </section>
  )
}
