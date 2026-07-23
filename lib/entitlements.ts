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
