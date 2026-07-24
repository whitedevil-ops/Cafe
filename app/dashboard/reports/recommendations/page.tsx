import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import RecommendationsClient from './recommendations-client'

export const dynamic = 'force-dynamic'

export default async function RecommendationsReportPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')
  if (cafe.role !== 'owner' && cafe.role !== 'manager') redirect('/dashboard/reports')

  return <RecommendationsClient cafeId={cafe.cafeId} timezone={cafe.timezone} />
}
