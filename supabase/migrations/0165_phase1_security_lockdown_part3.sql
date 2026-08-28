-- ============================================================================
-- Phase 1 security lockdown, part 3 — the daily expiry-suspension cron and
-- the Razorpay platform-billing webhook both write cafes.status/billing_status
-- directly via the service-role client instead of going through an audited
-- RPC. "Café suspended" — an event the ops audit spec explicitly requires to
-- be auditable — currently has a live production path that leaves zero trace
-- in platform_audit_logs.
--
-- These two callers run with NO authenticated admin session (a Vercel cron
-- and a Razorpay webhook), so they can't call op_set_cafe_status/etc. — those
-- require has_platform_permission(), which needs auth.uid(). This is a
-- separate, service-role-only function: same audited-write shape, but
-- actor_id is null (platform_audit_logs.actor_id is nullable — the same
-- "system, not a person" convention already used for order.created rows in
-- audit_logs) and a p_source string records which automated process acted,
-- so an operator reading the log can tell a cron/webhook change from an
-- admin's own action.
-- ============================================================================

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
declare v_before jsonb;
begin
  if p_source is null or trim(p_source) = '' then raise exception 'p_source is required'; end if;
  if p_status is not null and p_status not in ('active', 'suspended', 'disabled', 'archived') then
    raise exception 'invalid status';
  end if;

  select jsonb_build_object(
    'billing_status', billing_status, 'status', status,
    'subscription_ends_at', subscription_ends_at, 'plan', plan
  ) into v_before from cafes where id = p_cafe_id;
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
end $$;

-- Service-role only — not the ops panel, not any café-facing session.
revoke execute on function system_update_cafe_billing(uuid, text, text, text, text, timestamptz, text, boolean) from public, anon, authenticated;
grant execute on function system_update_cafe_billing(uuid, text, text, text, text, timestamptz, text, boolean) to service_role;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
begin
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
