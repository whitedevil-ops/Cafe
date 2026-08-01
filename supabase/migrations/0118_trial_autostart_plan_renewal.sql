-- ============================================================================
-- 0118 — Trial auto-start on first login, and auto-calculated suspension
-- dates on plan change/renewal.
--
-- Before this migration, a brand-new café's trial_ends_at/subscription_ends_at
-- stayed NULL forever (confirmed: create_or_resume_onboarding_cafe never sets
-- them, and nothing else did either) — so "trial" only ever expired if a
-- platform admin manually typed a date into op_extend_subscription. And
-- op_change_plan only ever touched the `plan` column, never the date, so
-- "upgrading" a café's plan had zero effect on when it would be suspended.
--
-- Two changes:
-- 1. ensure_trial_started(p_cafe_id) — called once, lazily, from the café
--    owner's first dashboard load after login (lib/cafe.ts). Sets both dates
--    to now()+14 days, but only if neither has ever been set — so it's a
--    no-op on every subsequent call.
-- 2. op_change_plan gains an optional p_effective_date (defaults to now()),
--    auto-computes subscription_ends_at from the plan (14d for trial, 365d
--    for any plan with real annual pricing, 30d fallback otherwise), and
--    reactivates a café that was suspended specifically for expiry. This is
--    also the "renewal" tool: the admin picks a plan + an effective date
--    (which can be back- or forward-dated) and the resulting suspension date
--    is computed, not typed in by hand. The existing raw-date
--    op_extend_subscription stays as a manual-override escape hatch for
--    anything this can't express.
--
-- Along the way: op_extend_subscription's auth check was quietly reverted by
-- 0114/0115 from has_platform_permission('subscriptions.manage') (0079) back
-- to plain is_platform_admin() — a real regression (a billing_admin has
-- subscriptions.manage:true but isn't is_platform_admin(), so the UI control
-- would render for them but the RPC would reject them). Restored here.
-- ============================================================================

create or replace function ensure_trial_started(p_cafe_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_cafe_member_any_status(p_cafe_id) then raise exception 'not authorized'; end if;

  update cafes
  set trial_ends_at = now() + interval '14 days',
      subscription_ends_at = now() + interval '14 days'
  where id = p_cafe_id and trial_ends_at is null and subscription_ends_at is null;
end $$;

revoke execute on function ensure_trial_started(uuid) from public, anon;
grant execute on function ensure_trial_started(uuid) to authenticated;

-- Signature is changing (new param) and so is the return type (void -&gt;
-- timestamptz) — CREATE OR REPLACE cannot do either across an identity-arg
-- change, so the old two-arg version has to go first.
drop function if exists op_change_plan(uuid, text);

create or replace function op_change_plan(
  p_cafe_id uuid, p_plan_key text, p_effective_date timestamptz default now()
) returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  v_before text;
  v_price_yearly integer;
  v_period_days integer;
  v_new_ends_at timestamptz;
  v_status text;
  v_status_reason text;
  v_was_expired boolean;
begin
  if not has_platform_permission('plans.change') then raise exception 'not authorized'; end if;

  select price_yearly into v_price_yearly from platform_plans where key = p_plan_key and active;
  if not found then raise exception 'unknown or inactive plan: %', p_plan_key; end if;

  select plan, status, status_reason into v_before, v_status, v_status_reason from cafes where id = p_cafe_id;
  if v_before is null then raise exception 'cafe not found'; end if;

  v_period_days := case
    when p_plan_key = 'trial' then 14
    when v_price_yearly is not null and v_price_yearly > 0 then 365
    else 30
  end;
  v_new_ends_at := coalesce(p_effective_date, now()) + (v_period_days || ' days')::interval;
  v_was_expired := v_status = 'suspended' and v_status_reason = 'Subscription expired';

  update cafes set
    plan = p_plan_key,
    subscription_ends_at = v_new_ends_at,
    expiry_reminder_sent_at = null,
    expiry_reminder_30d_sent_at = null,
    status = case when v_was_expired then 'active' else status end,
    status_reason = case when v_was_expired then null else status_reason end,
    status_changed_at = case when v_was_expired then now() else status_changed_at end
  where id = p_cafe_id;

  insert into platform_audit_logs (actor_id, action, target_type, target_id, previous_value, new_value)
  values (auth.uid(), 'cafe.plan_changed', 'cafe', p_cafe_id,
          jsonb_build_object('plan', v_before),
          jsonb_build_object('plan', p_plan_key, 'effective_date', p_effective_date, 'subscription_ends_at', v_new_ends_at));

  return v_new_ends_at;
end $$;

revoke execute on function op_change_plan(uuid, text, timestamptz) from public, anon;
grant execute on function op_change_plan(uuid, text, timestamptz) to authenticated;

-- Restores 0079's fine-grained permission check that 0114/0115 accidentally
-- dropped. Body is otherwise byte-for-byte identical to 0115's definition.
create or replace function op_extend_subscription(
  p_cafe_id uuid, p_subscription_ends_at timestamptz, p_trial_ends_at timestamptz default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_before jsonb;
begin
  if not has_platform_permission('subscriptions.manage') then raise exception 'not authorized'; end if;
  select jsonb_build_object('subscription_ends_at', subscription_ends_at, 'trial_ends_at', trial_ends_at)
    into v_before from cafes where id = p_cafe_id;
  if v_before is null then raise exception 'cafe not found'; end if;

  update cafes set subscription_ends_at = p_subscription_ends_at,
                  trial_ends_at = coalesce(p_trial_ends_at, trial_ends_at),
                  expiry_reminder_sent_at = null,
                  expiry_reminder_30d_sent_at = null
  where id = p_cafe_id;

  insert into platform_audit_logs (actor_id, action, target_type, target_id, previous_value, new_value)
  values (auth.uid(), 'cafe.subscription_extended', 'cafe', p_cafe_id, v_before,
          jsonb_build_object('subscription_ends_at', p_subscription_ends_at));
end $$;
