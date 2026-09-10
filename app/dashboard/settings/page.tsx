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
  // Entitlements run inside the batch below alongside the other queries
  // instead of blocking in front of them.
  const [
    { data },
    { data: members },
    { data: invites },
    { data: printers },
    { data: stations },
    { data: tokens },
    { data: roleOverview },
    onlinePaymentsAllowed,
    kitchenStationsAllowed,
  ] = await Promise.all([
    supabase
      .from('cafes')
      .select('name, upsell_threshold, kot_printing_enabled, kot_print_on_update, cash_management_enabled, recommendations_enabled, online_payments_enabled, razorpay_status')
      .eq('id', cafe.cafeId)
      .single(),
    supabase.rpc('list_cafe_staff_profiles', { p_cafe_id: cafe.cafeId }),
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
    hasFeature(cafe.cafeId, 'online_payments'),
    hasFeature(cafe.cafeId, 'kitchen_stations'),
  ])

  type StaffProfileRow = { user_id: string; role: string; status: string; full_name: string | null; email: string | null }
  const staff: StaffMember[] = ((members ?? []) as StaffProfileRow[]).map((m) => ({
    userId: m.user_id,
    role: m.role,
    status: m.status,
    name: m.full_name ?? null,
    email: m.email ?? null,
  }))

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
        kitchenStationsAllowed,
      }}
      roleOverview={(roleOverview ?? {}) as RoleScreenOverview}
    />
  )
}
