import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { getCurrentCafe } from '@/lib/cafe'
import OnboardingClient, { type OnboardingDraft } from './onboarding-client'

export const dynamic = 'force-dynamic'

export default async function OnboardingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Signup always lands here — but a brand-new user might actually be an
  // invited STAFF member (waiter/cashier/etc.) claiming a pending invite,
  // not someone registering a new café. Only check when they have no café
  // relationship at all yet, so an existing owner using "+ Add café" to
  // start a second café is never redirected away from this wizard.
  const { count: existingMembershipCount } = await supabase
    .from('cafe_members')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
  if (!existingMembershipCount) {
    // getCurrentCafe() claims any invite matching this email (see
    // claim_my_invites() in lib/cafe.ts) and returns the café if that
    // claim actually gave them somewhere real to work.
    const claimedCafe = await getCurrentCafe()
    if (claimedCafe) redirect('/dashboard')
  }

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
