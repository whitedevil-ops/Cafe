import { redirect } from 'next/navigation'
import { getCurrentCafe } from '@/lib/cafe'
import { createClient } from '@/utils/supabase/server'
import BillingClient, { type BillingState } from './billing-client'

export const dynamic = 'force-dynamic'

export default async function BillingPage() {
  const cafe = await getCurrentCafe()
  if (!cafe) redirect('/onboarding')

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('platform_billing_state', { p_cafe_id: cafe.cafeId })

  return (
    <BillingClient
      cafeId={cafe.cafeId}
      role={cafe.role}
      initialState={(error ? null : (data as BillingState)) ?? null}
    />
  )
}
