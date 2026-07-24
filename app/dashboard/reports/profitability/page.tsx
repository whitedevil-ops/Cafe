import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import ProfitabilityClient from './profitability-client'

export const dynamic = 'force-dynamic'

export default async function ProfitabilityPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')
  // Sensitive: contribution/margin is owner/manager only (spec §6). The
  // profitability_report RPC re-checks this server-side regardless of the UI.
  if (cafe.role !== 'owner' && cafe.role !== 'manager') redirect('/dashboard/reports')

  return <ProfitabilityClient cafeId={cafe.cafeId} cafeName={cafe.name} timezone={cafe.timezone} />
}
