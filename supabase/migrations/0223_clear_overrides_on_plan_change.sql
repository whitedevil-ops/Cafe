-- ============================================================================
-- 0223 — op_change_plan clears the café's per-feature overrides when the
-- plan actually changes.
--
-- A feature override (cafe_feature_overrides) is a manual, per-café
-- exception to whatever plan that café is on — the entitlement precedence
-- is override -> plan default -> false everywhere it's resolved
-- (cafe_has_feature, cafe_feature_for_guest, the Ops Features tab). Until
-- now, op_change_plan (0188) only touched cafes.plan/subscription fields;
-- any override set while the café was on its old plan silently carried
-- forward onto the new one, so a plan switch in Ops did not reliably give a
-- clean copy of the new plan's defaults — an override left over from Growth
-- could keep suppressing (or force-enabling) a feature after switching to
-- Android/Starter/whatever, contrary to what "change plan" means to Ops.
--
-- Fix: after the plan actually changes (guarded so re-saving the same plan,
-- e.g. only to adjust the effective date, is a no-op), delete every row in
-- cafe_feature_overrides for that café and audit-log what was cleared.
--
-- Pure re-body of op_change_plan, copy-forward from 0188 — only the new
-- override-clearing block and its declared variable are added.
-- ============================================================================

create or replace function op_change_plan(
  p_cafe_id uuid, p_plan_key text, p_effective_date timestamptz default now()
) returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  v_before text;
  v_owner_id uuid;
  v_price_yearly integer;
  v_period_days integer;
  v_new_ends_at timestamptz;
  v_status text;
  v_status_reason text;
  v_was_expired boolean;
  v_cleared_overrides jsonb;
begin
  if not has_platform_permission('plans.change') then raise exception 'not authorized'; end if;

  select price_yearly into v_price_yearly from platform_plans where key = p_plan_key and active;
  if not found then raise exception 'unknown or inactive plan: %', p_plan_key; end if;

  select plan, status, status_reason, owner_id into v_before, v_status, v_status_reason, v_owner_id from cafes where id = p_cafe_id;
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

  if p_plan_key is distinct from v_before then
    select jsonb_agg(jsonb_build_object('feature_key', feature_key, 'enabled', enabled))
      into v_cleared_overrides
      from cafe_feature_overrides where cafe_id = p_cafe_id;

    if v_cleared_overrides is not null then
      delete from cafe_feature_overrides where cafe_id = p_cafe_id;

      insert into platform_audit_logs (actor_id, action, target_type, target_id, previous_value, new_value)
      values (auth.uid(), 'cafe.feature_overrides_cleared', 'cafe', p_cafe_id,
              jsonb_build_object('overrides', v_cleared_overrides),
              jsonb_build_object('reason', 'plan_changed', 'plan', p_plan_key));
    end if;
  end if;

  perform reconcile_owner_cafe_cap(v_owner_id, 'op_change_plan');

  return v_new_ends_at;
end $$;

revoke execute on function op_change_plan(uuid, text, timestamptz) from public, anon;
grant execute on function op_change_plan(uuid, text, timestamptz) to authenticated;

-- ── self-check ─────────────────────────────────────────────────────────────
-- op_change_plan is permission-gated on auth.uid() (has_platform_permission),
-- which has no value in a migration's execution context — calling it
-- end-to-end here would only prove "not authorized" works, not the new
-- logic. Instead confirm the redefinition actually landed and contains the
-- clearing block, which is what a stale-cache/wrong-branch mistake would get
-- wrong.
do $$
declare v_src text;
begin
  select pg_get_functiondef('op_change_plan(uuid, text, timestamptz)'::regprocedure) into v_src;
  if v_src is null then raise exception 'op_change_plan not found after redefinition'; end if;
  if v_src not ilike '%delete from cafe_feature_overrides%' then
    raise exception 'op_change_plan does not clear cafe_feature_overrides';
  end if;
  if v_src not ilike '%is distinct from v_before%' then
    raise exception 'op_change_plan is missing the no-op-on-same-plan guard';
  end if;
end $$;
