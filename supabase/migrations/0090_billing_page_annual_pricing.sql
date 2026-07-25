-- ============================================================================
-- 0090 — Fix the owner-facing Billing page (/dashboard/billing) to show the
-- real pricing (Starter ₹10,000/yr, Growth ₹18,000/yr, Scale ₹25,000/yr —
-- see 0083) instead of the old ₹999/₹2,499/₹4,999 per MONTH figures it was
-- still displaying, because platform_billing_state (0074) has always read
-- price_monthly, and 0083 only ever added price_yearly for the
-- platform-admin screen, never touched this RPC.
--
-- SAFETY: platform_plans.razorpay_plan_id (0074) points at real Razorpay
-- Plan objects — whichever ones exist were created for the OLD monthly
-- pricing. If this migration only changed the DISPLAYED number, "Switch to
-- this plan" would still subscribe someone to the old monthly-cycle plan
-- while the screen told them a completely different annual price — a real
-- mismatch between what's shown and what gets charged. So this also clears
-- razorpay_plan_id on every tier, which makes platform_billing_state report
-- `available: false` for all three (same "unavailable, not broken" posture
-- 0074 already uses for any plan without one configured) until real annual
-- Razorpay Plan objects are created and wired in. No café currently has an
-- active subscription (confirmed live before writing this), so nothing paid
-- is affected.
-- ============================================================================

update platform_plans set razorpay_plan_id = null;

create or replace function platform_billing_state(p_cafe_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not has_cafe_role(p_cafe_id, array['owner','manager']::member_role[]) then
    raise exception 'only an owner or manager can view billing';
  end if;

  select jsonb_build_object(
    'plan', c.plan,
    'plan_name', pp.name,
    'price_monthly', pp.price_monthly,
    'price_yearly', pp.price_yearly,
    'renewal_price_yearly', pp.renewal_price_yearly,
    'billing_status', c.billing_status,
    'subscription_ends_at', c.subscription_ends_at,
    'status', c.status,
    'plans', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'key', key, 'name', name,
        'price_monthly', price_monthly,
        'price_yearly', price_yearly,
        'renewal_price_yearly', renewal_price_yearly,
        'available', razorpay_plan_id is not null
      ) order by sort), '[]'::jsonb)
      from platform_plans
    )
  ) into v_result
  from cafes c
  left join platform_plans pp on pp.key = c.plan
  where c.id = p_cafe_id;

  return v_result;
end $$;

revoke execute on function platform_billing_state(uuid) from public, anon;
grant execute on function platform_billing_state(uuid) to authenticated;
