import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import { hasFeature } from '@/lib/entitlements'
import { UpgradeRequired } from '@/components/upgrade-required'
import { businessDayStartISO } from '@/lib/datetime'
import ReservationsClient, { type Reservation, type TableOption } from './reservations-client'

export const dynamic = 'force-dynamic'

export default async function ReservationsPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()

  if (!(await hasFeature(cafe.cafeId, 'reservations'))) {
    const { data: planRow } = await supabase.from('cafes').select('plan').eq('id', cafe.cafeId).maybeSingle()
    return <UpgradeRequired feature="Table Reservations" plan={planRow?.plan ?? 'current'} />
  }

  const from = businessDayStartISO(cafe.timezone)
  const to = new Date(new Date(from).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()

  const [{ data: reservations }, { data: tables }] = await Promise.all([
    supabase.rpc('list_reservations', { p_cafe_id: cafe.cafeId, p_from: from, p_to: to }),
    supabase.from('cafe_tables').select('id, label').eq('cafe_id', cafe.cafeId).eq('archived', false).order('label'),
  ])

  return (
    <ReservationsClient
      cafeId={cafe.cafeId}
      role={cafe.role}
      timezone={cafe.timezone}
      initialReservations={(reservations ?? []) as Reservation[]}
      tables={(tables ?? []) as TableOption[]}
    />
  )
}
