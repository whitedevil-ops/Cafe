-- ============================================================================
-- 0111 — Gate the referral program (0110) behind the Scale plan.
--
-- 0110 shipped referral_enabled as a plain owner-facing on/off switch with
-- no plan tier attached, deliberately, to keep that migration scoped to the
-- mechanics. On reflection this is a retention/growth feature in the same
-- family as loyalty/wallet/coupons, which ARE plan-gated (0073/0091) — and
-- unlike those (available from Growth up), this one is Scale-only.
--
-- cafe_has_feature (0019) already resolves per-café overrides ahead of
-- plan defaults generically for any feature key — no schema change needed
-- beyond registering the key in platform_plans.features. The platform-admin
-- FEATURES list (cafe-detail-client.tsx) is what actually surfaces a toggle
-- for it; updated alongside this migration, not here.
-- ============================================================================

update platform_plans set features = features || '{"referral": false}'::jsonb where key in ('trial', 'starter', 'pro');
update platform_plans set features = features || '{"referral": true}'::jsonb  where key = 'business';
