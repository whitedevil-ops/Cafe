import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import OnboardingClient, { type OnboardingDraft } from './onboarding-client'

export const dynamic = 'force-dynamic'

export default async function OnboardingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Resume a draft this user already started (server-persisted — never
  // trusted from localStorage). Excludes 'complete' cafés: those aren't
  // drafts, they're the "+ Add café" case, which should start a fresh wizard.
  const { data: draft } = await supabase
    .from('cafes')
    .select(
      'id, onboarding_step, name, business_type, phone, email, address, city, state, pincode, country, gst_registered, legal_name, gstin, dine_in, takeaway, onboarding_meta',
    )
    .eq('owner_id', user.id)
    .neq('onboarding_step', 'complete')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return <OnboardingClient draft={draft as OnboardingDraft | null} />
}
