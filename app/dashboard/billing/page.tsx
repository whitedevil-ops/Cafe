import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import { legalDocVersion } from '@/lib/legal-content'
import BillingClient, { type BillingState } from './billing-client'

export const dynamic = 'force-dynamic'

const TERMS_VERSION = legalDocVersion('terms')

export default async function BillingPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()
  const isOwner = cafe.role === 'owner'
  const [{ data, error }, { data: acceptedTerms }] = await Promise.all([
    supabase.rpc('platform_billing_state', { p_cafe_id: cafe.cafeId }),
    isOwner
      ? supabase.rpc('has_accepted_legal_doc', { p_doc_type: 'terms', p_doc_version: TERMS_VERSION })
      : Promise.resolve({ data: null }),
  ])

  return (
    <BillingClient
      cafeId={cafe.cafeId}
      role={cafe.role}
      initialState={(error ? null : (data as BillingState)) ?? null}
      initialHasAcceptedTerms={isOwner ? acceptedTerms === true : null}
    />
  )
}
