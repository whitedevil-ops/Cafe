import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import { hasFeature } from '@/lib/entitlements'
import { UpgradeRequired } from '@/components/upgrade-required'
import FeedbackClient, { type FeedbackEntry, type FeedbackSummary } from './feedback-client'
import { businessDaysAgoStartISO } from '@/lib/datetime'

export const dynamic = 'force-dynamic'

export default async function FeedbackPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()

  if (!(await hasFeature(cafe.cafeId, 'feedback'))) {
    const { data: planRow } = await supabase.from('cafes').select('plan').eq('id', cafe.cafeId).maybeSingle()
    return <UpgradeRequired feature="Customer Feedback" plan={planRow?.plan ?? 'current'} />
  }

  const from = businessDaysAgoStartISO(29, cafe.timezone)
  const to = new Date().toISOString()

  const [{ data: entries }, { data: summary }] = await Promise.all([
    supabase
      .from('feedback')
      .select('id, rating, comment, created_at, orders(short_code)')
      .eq('cafe_id', cafe.cafeId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase.rpc('feedback_summary', { p_cafe_id: cafe.cafeId, p_from: from, p_to: to }),
  ])

  return (
    <FeedbackClient
      timezone={cafe.timezone}
      initialEntries={(entries ?? []) as unknown as FeedbackEntry[]}
      initialSummary={(summary as FeedbackSummary) ?? null}
    />
  )
}
