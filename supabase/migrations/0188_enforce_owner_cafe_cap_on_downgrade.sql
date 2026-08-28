-- ============================================================================
-- 0188 — full-audit follow-up: multi-café plan downgrade had zero
-- enforcement after café creation.
--
-- Confirmed live (18-domain audit, then a dedicated 3-agent re-check): the
-- cap in owned_cafe_capacity()/create_or_resume_onboarding_cafe() (0059) is
-- ONLY ever read at the instant of creating a NEW café. Every path that
-- changes an EXISTING café's plan afterward — op_change_plan (ops admin),
-- system_update_cafe_billing (Razorpay webhook + the daily expiry cron) —
-- never re-checks the owner's total café count against it. A Growth owner
-- (cap 2) with 2 cafés who downgrades either café to Starter (cap 1) keeps
-- both cafés running POS/QR ordering/dashboard access fully, forever, with
-- no signal to the owner or ops that anything is wrong.
--
-- Per explicit product decision: keep the existing MAX-across-owned-cafés
-- cap formula exactly as-is (0059's own anti-gaming rule — "caps only ever
-- combine via MAX, never subtract" — is left untouched on purpose; this
-- migration does not change what the cap IS, only enforces it going
-- forward). When an owner's aggregate cap now sits below their number of
-- currently-active cafés, suspend the excess immediately — no grace period,
-- matching this migration's own product decision.
--
-- Which café(s) get suspended: the most-recently-created active café(s)
-- first, keeping the owner's oldest (their original/primary) café running —
-- the same `order by created_at desc` precedent 0059 itself already uses to
-- find an in-progress onboarding draft. A café already suspended/disabled/
-- archived is left alone (it isn't consuming an active slot either way).
--
-- reconcile_owner_cafe_cap() is deliberately fully internal — no grant to
-- any role, not even service_role (same posture as claim_gst_invoice_number
-- and reverse_stock_for_cancelled_order) — it only ever runs as a plain
-- SQL call from inside another SECURITY DEFINER function that already
-- resolved the affected café's owner, never as a directly callable RPC.
-- ============================================================================

create or replace function reconcile_owner_cafe_cap(p_owner_id uuid, p_source text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_cap          integer;
  v_active_count integer;
  v_excess       integer;
  v_cafe         record;
begin
  select coalesce(max(pp.max_owned_cafes), 1) into v_cap
    from cafes c join platform_plans pp on pp.key = c.plan
   where c.owner_id = p_owner_id;

  select count(*) into v_active_count from cafes where owner_id = p_owner_id and status = 'active';

  v_excess := v_active_count - v_cap;
  if v_excess <= 0 then
    return;
  end if;

  for v_cafe in
    select id, plan from cafes
     where owner_id = p_owner_id and status = 'active'
     order by created_at desc
     limit v_excess
  loop
    update cafes set
      status = 'suspended',
      status_reason = 'This café was suspended automatically because your account''s plan(s) no longer cover the number of cafés you own. Upgrade a plan or contact support to reactivate.',
      status_changed_at = now()
    where id = v_cafe.id;

    insert into platform_audit_logs (actor_id, action, target_type, target_id, previous_value, new_value)
    values (
      null, 'cafe.auto_suspended_over_cap', 'cafe', v_cafe.id,
      jsonb_build_object('status', 'active', 'plan', v_cafe.plan),
      jsonb_build_object('status', 'suspended', 'reason', 'over_cafe_cap', 'source', p_source, 'owner_cap', v_cap)
    );
  end loop;
end $$;

revoke execute on function reconcile_owner_cafe_cap(uuid, text) from public, anon, authenticated, service_role;

-- ── op_change_plan: reconcile the owner's whole café set after an admin ────
-- changes any ONE of their café's plans (the violation is an aggregate
-- condition across all their cafés, not a property of the café being
-- changed). Unchanged signature (3 params) — pure re-body.
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

  perform reconcile_owner_cafe_cap(v_owner_id, 'op_change_plan');

  return v_new_ends_at;
end $$;

revoke execute on function op_change_plan(uuid, text, timestamptz) from public, anon;
grant execute on function op_change_plan(uuid, text, timestamptz) to authenticated;

-- ── system_update_cafe_billing: same reconciliation after the Razorpay ─────
-- webhook or the daily expiry cron writes a plan/status change. Unchanged
-- signature (8 params) — pure re-body.
create or replace function system_update_cafe_billing(
  p_cafe_id               uuid,
  p_source                text,
  p_billing_status        text default null,
  p_status                text default null,
  p_status_reason         text default null,
  p_subscription_ends_at  timestamptz default null,
  p_plan                  text default null,
  p_reset_reminders       boolean default false
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_before jsonb;
  v_owner_id uuid;
begin
  if p_source is null or trim(p_source) = '' then raise exception 'p_source is required'; end if;
  if p_status is not null and p_status not in ('active', 'suspended', 'disabled', 'archived') then
    raise exception 'invalid status';
  end if;

  select jsonb_build_object(
    'billing_status', billing_status, 'status', status,
    'subscription_ends_at', subscription_ends_at, 'plan', plan
  ), owner_id into v_before, v_owner_id from cafes where id = p_cafe_id;
  if v_before is null then raise exception 'cafe not found'; end if;

  update cafes set
    billing_status = coalesce(p_billing_status, billing_status),
    status = coalesce(p_status, status),
    status_reason = coalesce(p_status_reason, status_reason),
    status_changed_at = case when p_status is not null then now() else status_changed_at end,
    subscription_ends_at = coalesce(p_subscription_ends_at, subscription_ends_at),
    plan = coalesce(p_plan, plan),
    expiry_reminder_sent_at = case when p_reset_reminders then null else expiry_reminder_sent_at end,
    expiry_reminder_30d_sent_at = case when p_reset_reminders then null else expiry_reminder_30d_sent_at end
  where id = p_cafe_id;

  insert into platform_audit_logs (actor_id, action, target_type, target_id, previous_value, new_value)
  values (
    null, 'cafe.system_billing_update', 'cafe', p_cafe_id, v_before,
    jsonb_build_object(
      'billing_status', p_billing_status, 'status', p_status, 'subscription_ends_at', p_subscription_ends_at,
      'plan', p_plan, 'source', p_source
    )
  );

  perform reconcile_owner_cafe_cap(v_owner_id, p_source);
end $$;

revoke execute on function system_update_cafe_billing(uuid, text, text, text, text, timestamptz, text, boolean) from public, anon, authenticated;
grant execute on function system_update_cafe_billing(uuid, text, text, text, text, timestamptz, text, boolean) to service_role;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_proc where proname = 'reconcile_owner_cafe_cap') <> 1 then
    raise exception 'reconcile_owner_cafe_cap: expected exactly one overload';
  end if;
  if exists (
    select 1 from information_schema.routine_privileges
    where routine_name = 'reconcile_owner_cafe_cap' and grantee in ('authenticated', 'anon', 'PUBLIC', 'service_role')
  ) then
    raise exception 'reconcile_owner_cafe_cap must not be callable by any client role';
  end if;
  if (select count(*) from pg_proc where proname = 'op_change_plan') <> 1 then
    raise exception 'op_change_plan: expected exactly one overload';
  end if;
  if (select count(*) from pg_proc where proname = 'system_update_cafe_billing') <> 1 then
    raise exception 'system_update_cafe_billing: expected exactly one overload';
  end if;
  if exists (
    select 1 from information_schema.routine_privileges
    where routine_name = 'system_update_cafe_billing' and grantee in ('authenticated', 'anon', 'PUBLIC')
  ) then
    raise exception 'system_update_cafe_billing must not be callable by authenticated/anon/public';
  end if;
end $$;
