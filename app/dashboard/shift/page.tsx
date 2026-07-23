import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import ShiftClient, { type ShiftSummary, type ShiftHistoryRow } from './shift-client'

export const dynamic = 'force-dynamic'

export default async function ShiftPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()
  const [{ data: current }, { data: history }] = await Promise.all([
    supabase.rpc('current_shift', { p_cafe_id: cafe.cafeId }),
    supabase.rpc('recent_shifts', { p_cafe_id: cafe.cafeId, p_limit: 15 }),
  ])

  return (
    <ShiftClient
      cafeId={cafe.cafeId}
      timezone={cafe.timezone}
      role={cafe.role}
      initialShift={(current ?? null) as ShiftSummary | null}
      initialHistory={(history ?? []) as ShiftHistoryRow[]}
    />
  )
}
