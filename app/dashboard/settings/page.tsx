import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import SettingsClient, { type StaffMember, type StaffInvite } from './settings-client'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()
  const [{ data }, { data: members }, { data: invites }] = await Promise.all([
    supabase
      .from('cafes')
      .select('name, upi_id, upi_name, upsell_threshold')
      .eq('id', cafe.cafeId)
      .single(),
    supabase
      .from('cafe_members')
      .select('user_id, role, status, profiles(full_name, email)')
      .eq('cafe_id', cafe.cafeId),
    supabase.from('cafe_invites').select('id, email, role').eq('cafe_id', cafe.cafeId),
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
        upi_id: data?.upi_id ?? '',
        upi_name: data?.upi_name ?? '',
        upsell_threshold: data?.upsell_threshold ?? 150,
      }}
      initialStaff={staff}
      initialInvites={(invites ?? []) as StaffInvite[]}
    />
  )
}
