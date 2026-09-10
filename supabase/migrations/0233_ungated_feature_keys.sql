-- ============================================================================
-- 0233 — seeds 19 new platform_plans.features keys, all `true` on every
-- plan, for capabilities that have never had ANY entitlement gate in the
-- product: they were simply always on for every café regardless of plan.
--
-- This is Batch 0 of a larger project (Ops Admin "Always Included" tab
-- getting real, working toggles instead of a read-only list). It adds NO
-- consuming code whatsoever — nothing in the app or any RPC calls
-- cafe_has_feature()/cafe_feature_for_guest()/hasFeature() with any of
-- these 19 strings yet. That makes this migration PROVABLY a no-op for
-- every live café: coalesce((features ->> key)::boolean, false) is never
-- evaluated against these keys until the enforcement migrations that
-- follow this one land, each in its own separately-verified batch.
--
-- MUST be confirmed live (select key, features from platform_plans) before
-- ANY later batch in this project ships — if enforcement code shipped
-- first, every one of these checks would resolve to false (the key
-- wouldn't exist yet), breaking KOT printing, dine-in/takeaway ordering,
-- refunds, and more, platform-wide, immediately.
--
-- Plain `||` merge, not jsonb_set: every value here is the constant true,
-- not derived from another column (unlike 0204's spin-key seed, which used
-- jsonb_set + a `where not (features ? 'spin')` guard specifically because
-- it copied each row's own then-current 'loyalty' value — a second run of
-- an unguarded copy could pick up a drifted value). A plain unconditional
-- merge of a constant produces an identical result on every run, so there
-- is nothing for a guard to protect against here — matching the simpler
-- precedent already used in 0083/0111/0158 for constant-value key seeds.
-- ============================================================================

update platform_plans
   set features = features || '{
     "kot_printing": true,       "kot_reprint": true,        "bluetooth_printer": true,
     "desktop_printing": true,   "kitchen_stations": true,   "live_tables": true,
     "discounts": true,          "held_orders": true,        "order_cancel": true,
     "digital_receipts": true,   "split_payments": true,     "refunds": true,
     "waiter_quick_add": true,   "customer_my_orders": true, "upsell_prompt": true,
     "core_reports": true,       "dine_in_ordering": true,   "takeaway_ordering": true,
     "cash_management": true
   }'::jsonb;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
declare v_missing text;
begin
  select string_agg(key, ', ') into v_missing
    from platform_plans
   where not (features ?& array[
     'kot_printing','kot_reprint','bluetooth_printer','desktop_printing','kitchen_stations',
     'live_tables','discounts','held_orders','order_cancel','digital_receipts',
     'split_payments','refunds','waiter_quick_add','customer_my_orders','upsell_prompt',
     'core_reports','dine_in_ordering','takeaway_ordering','cash_management'
   ]);
  if v_missing is not null then
    raise exception 'platform_plans missing one or more new feature keys on plan(s): % — every café on those plans would resolve these as false once enforcement ships', v_missing;
  end if;
end $$;
