'use client'

import { useMemo, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useToast } from '@/components/ui/toast'

export type RoleScreenOverview = Record<string, Record<string, boolean>>

const ROLES = ['manager', 'cashier', 'kitchen', 'waiter', 'accountant'] as const

const SCREENS: { key: string; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'pos', label: 'POS' },
  { key: 'tables', label: 'Live tables' },
  { key: 'bills', label: 'Bills' },
  { key: 'shift', label: 'Shift & cash' },
  { key: 'kitchen', label: 'Kitchen' },
  { key: 'menu', label: 'Menu' },
  { key: 'customers', label: 'Customers' },
  { key: 'feedback', label: 'Feedback' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'purchases', label: 'Purchases' },
  { key: 'recipes', label: 'Recipes & cost' },
  { key: 'coupons', label: 'Coupons & offers' },
  { key: 'loyalty', label: 'Loyalty & rewards' },
  { key: 'wallet', label: 'Wallet' },
  { key: 'reservations', label: 'Reservations' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'reports', label: 'Reports' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'profile', label: 'Café profile' },
  { key: 'qr_codes', label: 'QR codes' },
  { key: 'billing', label: 'Billing' },
  { key: 'settings', label: 'Settings' },
]

// Every non-owner role's access is fully configurable here — the owner
// role itself is never shown, since it always has full access (0096).
export default function RoleAccessPanel({
  cafeId,
  canManage,
  initialOverview,
}: {
  cafeId: string
  canManage: boolean
  initialOverview: RoleScreenOverview
}) {
  const supabase = useMemo(() => createClient(), [])
  const { toast } = useToast()
  const [overview, setOverview] = useState(initialOverview)
  const [role, setRole] = useState<(typeof ROLES)[number]>('waiter')
  const [saving, setSaving] = useState<string | null>(null)

  async function toggle(screenKey: string, next: boolean) {
    setOverview((o) => ({ ...o, [role]: { ...o[role], [screenKey]: next } }))
    setSaving(screenKey)
    const { error } = await supabase.rpc('set_role_screen', {
      p_cafe_id: cafeId, p_role: role, p_screen_key: screenKey, p_enabled: next,
    })
    setSaving(null)
    if (error) {
      setOverview((o) => ({ ...o, [role]: { ...o[role], [screenKey]: !next } }))
      toast(error.message, 'error')
    }
  }

  const roleScreens = overview[role] ?? {}

  return (
    <section className="mt-10 rounded-xl border border-border bg-surface p-6">
      <h2 className="flex items-center gap-2 text-base font-medium text-foreground">
        <ShieldCheck size={17} /> Role access
      </h2>
      <p className="mt-1 max-w-lg text-[13px] leading-relaxed text-muted-foreground">
        Which sections of the dashboard each role can open — a waiter doesn&apos;t need Settings, a kitchen
        account doesn&apos;t need Bills. Pick a role, then check what it should see. The owner role always
        has full access.
      </p>

      <div className="mt-4 flex items-center gap-2">
        <label htmlFor="role-access-select" className="text-[13px] text-muted-foreground">Role</label>
        <select
          id="role-access-select"
          value={role}
          onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}
          className="h-10 rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[16px] capitalize text-foreground"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>

      <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
        {SCREENS.map((s) => {
          const on = roleScreens[s.key] ?? false
          return (
            <li key={s.key}>
              <label className="flex min-h-9 items-center gap-2 text-[13.5px] text-foreground">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!canManage || saving === s.key}
                  onChange={(e) => toggle(s.key, e.target.checked)}
                  className="h-4 w-4 rounded border-border-strong accent-primary disabled:opacity-40"
                />
                {s.label}
              </label>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
