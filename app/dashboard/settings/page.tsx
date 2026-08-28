import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { hasFeature } from '@/lib/entitlements'
import { createClient } from '@/utils/supabase/server'
import SettingsClient, { type StaffMember, type StaffInvite } from './settings-client'
import type { KotPrinter, KitchenStation, BridgeToken } from './kot-printing-panel'
import type { RoleScreenOverview } from './role-access-panel'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()
  // Entitlement first: everything the Payments card says depends on whether
  // online payments are on this cafe's plan at all.
  const onlinePaymentsAllowed = await hasFeature(cafe.cafeId, 'online_payments')
  const [{ data }, { data: members }, { data: invites }, { data: printers }, { data: stations }, { data: tokens }, { data: roleOverview }] =
    await Promise.all([
      supabase
        .from('cafes')
        .select('name, upsell_threshold, kot_printing_enabled, kot_print_on_update, cash_management_enabled, recommendations_enabled, online_payments_enabled, razorpay_status')
        .eq('id', cafe.cafeId)
        .single(),
      supabase
        .from('cafe_members')
        .select('user_id, role, status, profiles(full_name, email)')
        .eq('cafe_id', cafe.cafeId),
      supabase.from('cafe_invites').select('id, email, role').eq('cafe_id', cafe.cafeId),
      supabase.from('kot_printers').select('*').eq('cafe_id', cafe.cafeId).order('name'),
      supabase.from('kitchen_stations').select('id, name').eq('cafe_id', cafe.cafeId).order('sort'),
      supabase
        .from('print_bridge_tokens')
        .select('id, name, last_seen_at')
        .eq('cafe_id', cafe.cafeId)
        .is('revoked_at', null),
      (cafe.role === 'owner' || cafe.role === 'manager')
        ? supabase.rpc('role_screen_overview', { p_cafe_id: cafe.cafeId })
        : Promise.resolve({ data: null }),
    ])

  const staff: StaffMember[] = (members ?? []).map((m) => {
    const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
    return {
      userId: m.user_id,
      role: m.role,
      status: m.status,
      name: p?.full_name ?? null,
      email: p?.email ?? null,
    }
  })

  return (
    <SettingsClient
      cafeId={cafe.cafeId}
      myUserId={cafe.userId}
      myRole={cafe.role}
      initial={{
        name: data?.name ?? cafe.name,
        upsell_threshold: data?.upsell_threshold ?? 150,
        recommendations_enabled: data?.recommendations_enabled ?? true,
      }}
      initialStaff={staff}
      initialInvites={(invites ?? []) as StaffInvite[]}
      timezone={cafe.timezone}
      cashEnabled={data?.cash_management_enabled ?? false}
      onlinePayments={{
        allowed: onlinePaymentsAllowed,
        enabled: data?.online_payments_enabled ?? false,
        razorpayStatus: data?.razorpay_status ?? 'not_connected',
      }}
      printing={{
        enabled: data?.kot_printing_enabled ?? false,
        printOnUpdate: data?.kot_print_on_update ?? true,
        printers: (printers ?? []) as KotPrinter[],
        stations: (stations ?? []) as KitchenStation[],
        tokens: (tokens ?? []) as BridgeToken[],
      }}
      roleOverview={(roleOverview ?? {}) as RoleScreenOverview}
    />
  )
}
