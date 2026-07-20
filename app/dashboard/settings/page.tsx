import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import SettingsClient from './settings-client'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()
  const { data } = await supabase
    .from('cafes')
    .select('name, upi_id, upi_name, upsell_threshold')
    .eq('id', cafe.cafeId)
    .single()

  return (
    <SettingsClient
      cafeId={cafe.cafeId}
      initial={{
        name: data?.name ?? cafe.name,
        upi_id: data?.upi_id ?? '',
        upi_name: data?.upi_name ?? '',
        upsell_threshold: data?.upsell_threshold ?? 150,
      }}
    />
  )
}
