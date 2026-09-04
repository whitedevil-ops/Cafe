import { createClient } from '@/utils/supabase/server'

// Server-side entitlement check. Deliberately calls the existing
// cafe_has_feature() SQL function (0019) rather than reading cafes.plan and
// re-implementing the plan/override precedence in TypeScript — that function
// already resolves per-café overrides ahead of plan defaults and fails closed
// for non-members, and having two implementations of "is this allowed" is how
// they drift apart.
//
// This is a SERVER check. Hiding a nav link is a courtesy, not enforcement:
// anyone can type the URL. Every gated page must call this in its server
// component, and any privileged write must additionally be protected in SQL —
// which the existing RPCs already are, independently of plan tier.
export async function hasFeature(cafeId: string, feature: string): Promise<boolean> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('cafe_has_feature', {
    p_cafe_id: cafeId,
    p_feature: feature,
  })
  // Fail OPEN on a transport/RPC error, closed only on an explicit false.
  // A billing lookup that errors should never take a café's kitchen offline
  // mid-service; a genuine "not on your plan" answer still gates correctly.
  if (error) return true
  return data === true
}

// Every UpgradeRequired caller used to do `.from('cafes').select('plan')`
// and show that raw value directly — cafes.plan stores the internal KEY
// ('pro', 'business'), not the product-facing NAME ('Growth', 'Scale'), so a
// Growth café read "Your café is on the pro plan." This resolves the key to
// its real name via platform_plans, the same join dashboard/layout.tsx
// already did correctly for its own trial-expiry banner. Falls back to the
// raw key only if the café or plan row can't be found — still better than a
// thrown error on a page whose whole job is telling the owner what to do next.
export async function getCafePlanName(cafeId: string): Promise<string> {
  const supabase = await createClient()
  const { data: cafeRow } = await supabase.from('cafes').select('plan').eq('id', cafeId).maybeSingle()
  const key = cafeRow?.plan
  if (!key) return 'current'
  const { data: planRow } = await supabase.from('platform_plans').select('name').eq('key', key).maybeSingle()
  return planRow?.name ?? key
}
