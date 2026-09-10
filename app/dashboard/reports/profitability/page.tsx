import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { hasFeature, getCafePlanName } from '@/lib/entitlements'
import { UpgradeRequired } from '@/components/upgrade-required'
import { createClient } from '@/utils/supabase/server'
import { businessDaysAgoStartISO } from '@/lib/datetime'
import ProfitabilityClient, { type ProfitabilityPayload } from './profitability-client'

export const dynamic = 'force-dynamic'

export default async function ProfitabilityPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')
  // Sensitive: contribution/margin is owner/manager only (spec §6). The
  // profitability_report RPC re-checks this server-side regardless of the UI.
  if (cafe.role !== 'owner' && cafe.role !== 'manager') redirect('/dashboard/reports')

  if (!(await hasFeature(cafe.cafeId, 'advanced_reports'))) {
    return <UpgradeRequired feature="Profitability reporting" plan={await getCafePlanName(cafe.cafeId)} />
  }

  // Prefetches the client's own default view (30 days, all order types) —
  // matches sales-report-client's pattern so the page shows real numbers on
  // first paint instead of a client-side "Loading…" row every single visit.
  const from = businessDaysAgoStartISO(29, cafe.timezone)
  // +60s buffer, matching the client's own bounds() for the same range —
  // new Date().getTime() rather than Date.now() (flagged as an impure call
  // directly in a component body by this project's react-hooks/purity rule;
  // fine inside profitability-client.tsx's bounds() since that only runs
  // from a callback, never during render).
  const to = new Date(new Date().getTime() + 60_000).toISOString()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('profitability_report', {
    p_cafe_id: cafe.cafeId,
    p_from: from,
    p_to: to,
    p_type: 'all',
  })

  return (
    <ProfitabilityClient
      cafeId={cafe.cafeId}
      cafeName={cafe.name}
      timezone={cafe.timezone}
      initialPayload={(error ? null : (data as ProfitabilityPayload)) ?? null}
      initialError={error?.message ?? null}
    />
  )
}
