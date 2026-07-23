import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import SettingsClient, { type StaffMember, type StaffInvite } from './settings-client'
import type { KotPrinter, KitchenStation, BridgeToken } from './kot-printing-panel'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()
  const [{ data }, { data: members }, { data: invites }, { data: printers }, { data: stations }, { data: tokens }] =
    await Promise.all([
      supabase
        .from('cafes')
        .select('name, upsell_threshold, kot_printing_enabled, cash_management_enabled')
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
      }}
      initialStaff={staff}
      initialInvites={(invites ?? []) as StaffInvite[]}
      timezone={cafe.timezone}
      cashEnabled={data?.cash_management_enabled ?? false}
      printing={{
        enabled: data?.kot_printing_enabled ?? false,
        printers: (printers ?? []) as KotPrinter[],
        stations: (stations ?? []) as KitchenStation[],
        tokens: (tokens ?? []) as BridgeToken[],
      }}
    />
  )
}
