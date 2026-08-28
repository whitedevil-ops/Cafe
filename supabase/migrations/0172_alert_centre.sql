-- ============================================================================
-- Phase 3 — Alert Centre. Formalizes the 3 signals op_cafe_health() already
-- computes (subscription expiring, café inactivity, failed SMS deliveries)
-- into a real, persisted table with an actual open -> acknowledged ->
-- resolved lifecycle, instead of a purely observational dashboard.
--
-- Deliberately NOT built: payment failure, KDS/printer issue, auth anomaly,
-- system error, integration failure — none of these have a real backing
-- data source anywhere in this codebase today (no failed-payment log, no
-- printer/KDS telemetry, no login-anomaly detection, no error log, no
-- generic integration-health table). The alert_type CHECK constraint below
-- is closed to exactly the 3 real ones — adding a 4th requires a conscious
-- future migration, not a silent extension.
--
-- No cron/background-job infra exists beyond the daily check-expiry cron
-- (vercel.json has exactly one entry), which runs with a service-role
-- client and NO admin session — has_platform_permission() needs auth.uid(),
-- which a cron doesn't have (system_update_cafe_billing, 0165, exists for
-- exactly this reason). Piggybacking alert-sync onto that cron would mean a
-- THIRD copy of this 3-signal computation behind a new service-role-only
-- wrapper, plus bolting an unrelated concern onto an endpoint that already
-- carries real financial consequences (suspending cafés, billing emails).
-- Rejected. Sync is embedded directly in op_list_alerts() instead — it
-- reconciles on every read, so the list is never stale and no caller has to
-- remember a separate sync step. Café count is in the single digits; this
-- is cheap at today's scale, same judgment call 0169/0170 already made for
-- op_list_cafes/op_list_users.
-- ============================================================================

-- ── 1. The table ────────────────────────────────────────────────────────────
create table if not exists platform_alerts (
  id              uuid primary key default gen_random_uuid(),
  cafe_id         uuid not null references cafes(id) on delete cascade,
  alert_type      text not null check (alert_type in ('subscription_expiring', 'cafe_inactive', 'sms_failures')),
  severity        text not null check (severity in ('warning', 'critical')),
  message         text not null,
  status          text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  detected_at     timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users(id) on delete set null,
  resolved_at     timestamptz,
  resolved_by     uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists platform_alerts_status_idx on platform_alerts (status, severity, detected_at desc);

-- At most one LIVE (open/acknowledged) row per café+type. A resolved alert
-- does not block a fresh one from opening on the next sync if the condition
-- is still true (or becomes true again) -- resolving means "dealt with for
-- now", not "never alert me about this again".
create unique index if not exists platform_alerts_live_idx
  on platform_alerts (cafe_id, alert_type) where status in ('open', 'acknowledged');

alter table platform_alerts enable row level security;
create policy "admin read" on platform_alerts for select using (has_platform_permission('alerts.view'));
-- No insert/update/delete policy -- every write goes through the SECURITY
-- DEFINER RPCs below, same posture as platform_admins/platform_audit_logs.

-- ── 2. New permission pair: alerts.view (see) / alerts.manage (acknowledge,
--    resolve). Kept separate rather than reusing one key for both, so a
--    role literally named "read_only" cannot mutate alert state --
--    alerts.view tracks health.view's exact distribution (alerts ARE
--    health.view's 3 signals, formalized); alerts.manage tracks cafes.edit's
--    distribution (the two roles already trusted to change a café's
--    operational state). Full body copied verbatim from 0142 (the confirmed
--    latest definition) with only the two new keys inserted into every
--    branch -- this function has silently dropped keys on two prior
--    redefinitions (0142's own postmortem); the self-check block below
--    re-verifies an unrelated pre-existing key survived, specifically to
--    catch a third occurrence before it ships.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function role_default_permissions(p_role text)
returns jsonb language sql immutable as $$
  select case p_role
    when 'super_admin' then jsonb_build_object(
      'cafes.view', true, 'cafes.verify', true, 'cafes.edit', true, 'cafes.suspend', true,
      'cafes.delete', true, 'cafes.impersonate', true,
      'users.view', true, 'health.view', true, 'alerts.view', true, 'alerts.manage', true,
      'plans.view', true, 'plans.change', true, 'subscriptions.view', true, 'subscriptions.manage', true,
      'audit.view', true,
      'admins.view', true, 'admins.create', true, 'admins.edit', true, 'admins.disable', true,
      'leads.view', true, 'leads.manage', true
    )
    when 'operations_admin' then jsonb_build_object(
      'cafes.view', true, 'cafes.verify', true, 'cafes.edit', true, 'cafes.suspend', false,
      'cafes.delete', false, 'cafes.impersonate', false,
      'users.view', true, 'health.view', true, 'alerts.view', true, 'alerts.manage', true,
      'plans.view', false, 'plans.change', false, 'subscriptions.view', false, 'subscriptions.manage', false,
      'audit.view', false,
      'admins.view', false, 'admins.create', false, 'admins.edit', false, 'admins.disable', false,
      'leads.view', true, 'leads.manage', false
    )
    when 'support_admin' then jsonb_build_object(
      'cafes.view', true, 'cafes.verify', false, 'cafes.edit', false, 'cafes.suspend', false,
      'cafes.delete', false, 'cafes.impersonate', false,
      'users.view', true, 'health.view', true, 'alerts.view', true, 'alerts.manage', false,
      'plans.view', false, 'plans.change', false, 'subscriptions.view', false, 'subscriptions.manage', false,
      'audit.view', false,
      'admins.view', false, 'admins.create', false, 'admins.edit', false, 'admins.disable', false,
      'leads.view', false, 'leads.manage', false
    )
    when 'billing_admin' then jsonb_build_object(
      'cafes.view', true, 'cafes.verify', false, 'cafes.edit', false, 'cafes.suspend', false,
      'cafes.delete', false, 'cafes.impersonate', false,
      'users.view', false, 'health.view', false, 'alerts.view', false, 'alerts.manage', false,
      'plans.view', true, 'plans.change', true, 'subscriptions.view', true, 'subscriptions.manage', true,
      'audit.view', false,
      'admins.view', false, 'admins.create', false, 'admins.edit', false, 'admins.disable', false,
      'leads.view', false, 'leads.manage', false
    )
    when 'read_only' then jsonb_build_object(
      'cafes.view', true, 'cafes.verify', false, 'cafes.edit', false, 'cafes.suspend', false,
      'cafes.delete', false, 'cafes.impersonate', false,
      'users.view', true, 'health.view', true, 'alerts.view', true, 'alerts.manage', false,
      'plans.view', true, 'plans.change', false, 'subscriptions.view', true, 'subscriptions.manage', false,
      'audit.view', false,
      'admins.view', false, 'admins.create', false, 'admins.edit', false, 'admins.disable', false,
      'leads.view', true, 'leads.manage', false
    )
    else '{}'::jsonb
  end;
$$;

create or replace function op_update_admin_permissions(p_admin_id uuid, p_permissions jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_target platform_admins%rowtype;
  v_caller_admin_id uuid;
  v_key text;
  v_allowed text[] := array[
    'cafes.view','cafes.verify','cafes.edit','cafes.suspend','cafes.delete','cafes.impersonate',
    'users.view','health.view','alerts.view','alerts.manage',
    'plans.view','plans.change','subscriptions.view','subscriptions.manage',
    'audit.view',
    'admins.view','admins.create','admins.edit','admins.disable',
    'leads.view','leads.manage'
  ];
begin
  if not has_platform_permission('admins.edit') then raise exception 'not authorized'; end if;

  select id into v_caller_admin_id from platform_admins where user_id = auth.uid() and status = 'active';
  select * into v_target from platform_admins where id = p_admin_id;
  if v_target.id is null then raise exception 'admin not found'; end if;

  if v_target.id = v_caller_admin_id then
    raise exception 'you cannot change your own permissions';
  end if;

  for v_key in select jsonb_object_keys(coalesce(p_permissions, '{}'::jsonb)) loop
    if not (v_key = any(v_allowed)) then raise exception 'unknown permission: %', v_key; end if;
    if (p_permissions ->> v_key)::boolean and not has_platform_permission(v_key) then
      raise exception 'you cannot grant a permission you do not hold: %', v_key;
    end if;
  end loop;

  update platform_admins set permissions = coalesce(p_permissions, '{}'::jsonb), updated_at = now() where id = p_admin_id;

  insert into platform_audit_logs (actor_id, action, target_type, target_id, previous_value, new_value)
  values (auth.uid(), 'admin.permissions_changed', 'admin', p_admin_id, v_target.permissions, p_permissions);
end $$;

create or replace function op_create_admin(
  p_user_id uuid, p_full_name text, p_email text, p_role text, p_permissions jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_caller_role text;
  v_new_id uuid;
  v_key text;
  v_allowed text[] := array[
    'cafes.view','cafes.verify','cafes.edit','cafes.suspend','cafes.delete','cafes.impersonate',
    'users.view','health.view','alerts.view','alerts.manage',
    'plans.view','plans.change','subscriptions.view','subscriptions.manage',
    'audit.view',
    'admins.view','admins.create','admins.edit','admins.disable',
    'leads.view','leads.manage'
  ];
begin
  if not has_platform_permission('admins.create') then raise exception 'not authorized'; end if;
  if p_role not in ('super_admin', 'operations_admin', 'support_admin', 'billing_admin', 'read_only') then
    raise exception 'invalid role: %', p_role;
  end if;
  if p_full_name is null or trim(p_full_name) = '' then raise exception 'full name is required'; end if;
  if p_email is null or trim(p_email) = '' then raise exception 'email is required'; end if;

  for v_key in select jsonb_object_keys(coalesce(p_permissions, '{}'::jsonb)) loop
    if not (v_key = any(v_allowed)) then raise exception 'unknown permission: %', v_key; end if;
    if (p_permissions ->> v_key)::boolean and not has_platform_permission(v_key) then
      raise exception 'you cannot grant a permission you do not hold: %', v_key;
    end if;
  end loop;

  if p_role = 'super_admin' then
    select role into v_caller_role from platform_admins where user_id = auth.uid() and status = 'active';
    if v_caller_role <> 'super_admin' then
      raise exception 'only a super admin can create another super admin';
    end if;
  end if;

  insert into platform_admins (user_id, full_name, email, role, permissions, status, created_by)
  values (p_user_id, trim(p_full_name), lower(trim(p_email)), p_role, coalesce(p_permissions, '{}'::jsonb), 'active', auth.uid())
  returning id into v_new_id;

  insert into platform_audit_logs (actor_id, action, target_type, target_id, new_value)
  values (auth.uid(), 'admin.created', 'admin', v_new_id,
          jsonb_build_object('full_name', trim(p_full_name), 'email', lower(trim(p_email)), 'role', p_role, 'permissions', coalesce(p_permissions, '{}'::jsonb)));

  return v_new_id;
end $$;

-- ── 3. Live signal view -- pure computation over existing tables, same idiom
--    as v_cafe_onboarding (0019). Not queried directly by any client code --
--    only from inside op_list_alerts() below.
-- ────────────────────────────────────────────────────────────────────────────
create or replace view v_live_alert_signals
with (security_invoker = true) as
select
  c.id as cafe_id,
  'subscription_expiring'::text as alert_type,
  -- Critical once already expired OR inside 7 days (mirrors
  -- op_platform_overview's tightest expiring_7 window); warning out to 30
  -- days. Includes already-expired subscriptions, unlike app/ops/health's
  -- own 0-30-day-only card -- an expired subscription is just as real a
  -- signal as one 29 days out.
  case when c.subscription_ends_at < now() + interval '7 days' then 'critical' else 'warning' end as severity,
  case when c.subscription_ends_at < now()
       then c.name || '''s subscription expired ' || (extract(day from now() - c.subscription_ends_at))::int || ' day(s) ago'
       else c.name || '''s subscription expires in ' || (extract(day from c.subscription_ends_at - now()))::int || ' day(s)'
       end as message,
  now() as detected_at
from cafes c
where c.status <> 'archived' and c.subscription_ends_at is not null and c.subscription_ends_at < now() + interval '30 days'

union all

select
  c.id, 'cafe_inactive', 'warning',
  case when lo.last_order is null
       then c.name || ' has never had an order (created ' || (extract(day from now() - c.created_at))::int || ' day(s) ago)'
       else c.name || ' has had no orders in ' || (extract(day from now() - lo.last_order))::int || ' day(s)'
       end,
  now()
from cafes c
left join (select cafe_id, max(created_at) as last_order from orders where status <> 'cancelled' group by cafe_id) lo on lo.cafe_id = c.id
-- Restricted to status='active' -- matches app/ops/health/page.tsx's own
-- deliberate restriction, not invented here. A suspended/disabled café
-- having no orders is not a signal worth an alert.
where c.status = 'active' and (lo.last_order is null or lo.last_order < now() - interval '7 days')

union all

select
  c.id, 'sms_failures', 'critical',
  sms.failed_count || ' failed SMS delivery attempt(s) for ' || c.name,
  now()
from cafes c
join (select cafe_id, count(*) as failed_count from sms_logs where status = 'failed' group by cafe_id) sms on sms.cafe_id = c.id
where c.status <> 'archived';

-- ── 4. Read + sync in one call -- NOT `stable`, it writes on every read
--    (same rationale documented above: no cron infra exists to sync
--    separately). If this is ever "cleaned up" to add `stable` back for
--    consistency with sibling op_list_* RPCs, it will silently stop
--    syncing -- do not do that.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function op_list_alerts(p_status text default null)
returns table (
  id uuid, cafe_id uuid, cafe_name text, alert_type text, severity text, message text,
  detected_at timestamptz, status text,
  acknowledged_by uuid, acknowledged_at timestamptz,
  resolved_by uuid, resolved_at timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  if not has_platform_permission('alerts.view') then raise exception 'not authorized'; end if;
  if p_status is not null and p_status not in ('open', 'acknowledged', 'resolved') then
    raise exception 'invalid status: %', p_status;
  end if;

  -- Open a new instance for every currently-crossing signal, or refresh an
  -- already-open/acknowledged one in place (e.g. "2 failed" -> "5 failed")
  -- without spawning a duplicate -- detected_at on an existing row is left
  -- untouched, and acknowledged/resolved state is never touched here.
  insert into platform_alerts (cafe_id, alert_type, severity, message, detected_at)
  select cafe_id, alert_type, severity, message, detected_at from v_live_alert_signals
  on conflict (cafe_id, alert_type) where status in ('open', 'acknowledged')
  do update set message = excluded.message, severity = excluded.severity;

  -- Auto-resolve: a live alert whose condition is no longer true (renewed,
  -- an order came in, SMS retried successfully) closes itself and is
  -- audit-logged with a null actor, distinct from an operator's own
  -- op_resolve_alert call -- an operator should never have to manually
  -- clear something that already fixed itself, but the event still belongs
  -- in the audit trail.
  with cleared as (
    update platform_alerts pa
    set status = 'resolved', resolved_at = now(), resolved_by = null
    where pa.status in ('open', 'acknowledged')
      and not exists (select 1 from v_live_alert_signals v where v.cafe_id = pa.cafe_id and v.alert_type = pa.alert_type)
    returning pa.id, pa.cafe_id, pa.alert_type
  )
  insert into platform_audit_logs (actor_id, action, target_type, target_id, new_value)
  select null, 'alert.auto_resolved', 'alert', cleared.id, jsonb_build_object('cafe_id', cleared.cafe_id, 'alert_type', cleared.alert_type)
  from cleared;

  return query
  select pa.id, pa.cafe_id, c.name, pa.alert_type, pa.severity, pa.message, pa.detected_at, pa.status,
         pa.acknowledged_by, pa.acknowledged_at, pa.resolved_by, pa.resolved_at
  from platform_alerts pa
  join cafes c on c.id = pa.cafe_id
  where p_status is null or pa.status = p_status
  order by
    case pa.status when 'open' then 0 when 'acknowledged' then 1 else 2 end,
    case pa.severity when 'critical' then 0 else 1 end,
    pa.detected_at desc
  limit 300;
end $$;

-- ── 5. Triage actions -- gated on alerts.manage, not alerts.view. ──────────
create or replace function op_acknowledge_alert(p_alert_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_alert platform_alerts%rowtype;
begin
  if not has_platform_permission('alerts.manage') then raise exception 'not authorized'; end if;

  select * into v_alert from platform_alerts where id = p_alert_id;
  if v_alert.id is null then raise exception 'alert not found'; end if;
  if v_alert.status <> 'open' then raise exception 'only an open alert can be acknowledged'; end if;

  update platform_alerts set status = 'acknowledged', acknowledged_by = auth.uid(), acknowledged_at = now()
  where id = p_alert_id;

  insert into platform_audit_logs (actor_id, action, target_type, target_id, previous_value, new_value)
  values (auth.uid(), 'alert.acknowledged', 'alert', p_alert_id,
          jsonb_build_object('status', v_alert.status),
          jsonb_build_object('status', 'acknowledged', 'cafe_id', v_alert.cafe_id, 'alert_type', v_alert.alert_type));
end $$;

-- Resolvable from 'open' OR 'acknowledged' -- an operator who already fixed
-- something out-of-band shouldn't be forced through an acknowledge step first.
create or replace function op_resolve_alert(p_alert_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_alert platform_alerts%rowtype;
begin
  if not has_platform_permission('alerts.manage') then raise exception 'not authorized'; end if;

  select * into v_alert from platform_alerts where id = p_alert_id;
  if v_alert.id is null then raise exception 'alert not found'; end if;
  if v_alert.status = 'resolved' then raise exception 'alert is already resolved'; end if;

  update platform_alerts set status = 'resolved', resolved_by = auth.uid(), resolved_at = now()
  where id = p_alert_id;

  insert into platform_audit_logs (actor_id, action, target_type, target_id, previous_value, new_value)
  values (auth.uid(), 'alert.resolved', 'alert', p_alert_id,
          jsonb_build_object('status', v_alert.status),
          jsonb_build_object('status', 'resolved', 'cafe_id', v_alert.cafe_id, 'alert_type', v_alert.alert_type));
end $$;

revoke execute on function op_list_alerts(text) from public, anon;
revoke execute on function op_acknowledge_alert(uuid) from public, anon;
revoke execute on function op_resolve_alert(uuid) from public, anon;
grant execute on function op_list_alerts(text) to authenticated;
grant execute on function op_acknowledge_alert(uuid) to authenticated;
grant execute on function op_resolve_alert(uuid) to authenticated;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
declare v_count integer;
begin
  select count(*) into v_count from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('op_list_alerts', 'op_acknowledge_alert', 'op_resolve_alert');
  if v_count <> 3 then raise exception 'expected 3 new alert RPCs, found %', v_count; end if;

  if not exists (select 1 from pg_indexes where indexname = 'platform_alerts_live_idx') then
    raise exception 'platform_alerts_live_idx is missing -- sync would create duplicate live alerts';
  end if;

  if coalesce((role_default_permissions('super_admin') ->> 'alerts.manage')::boolean, false) is distinct from true then
    raise exception 'role_default_permissions(super_admin).alerts.manage did not set to true';
  end if;
  if coalesce((role_default_permissions('billing_admin') ->> 'alerts.view')::boolean, false) is distinct from false then
    raise exception 'role_default_permissions(billing_admin).alerts.view should be false';
  end if;
  if coalesce((role_default_permissions('support_admin') ->> 'alerts.manage')::boolean, false) is distinct from false then
    raise exception 'role_default_permissions(support_admin).alerts.manage should be false';
  end if;
  -- Regression guard for the exact bug 0142 fixed twice: unrelated
  -- pre-existing keys must still be intact after this re-body.
  if coalesce((role_default_permissions('super_admin') ->> 'cafes.delete')::boolean, false) is distinct from true then
    raise exception 'role_default_permissions(super_admin).cafes.delete regressed';
  end if;
  if coalesce((role_default_permissions('super_admin') ->> 'leads.manage')::boolean, false) is distinct from true then
    raise exception 'role_default_permissions(super_admin).leads.manage regressed';
  end if;
end $$;

-- Migrations run with no auth.uid(), so 'not authorized' is the expected,
-- successful outcome here -- same pattern as 0168/0169's self-checks.
do $$
begin
  begin perform op_list_alerts();
  exception when others then if sqlerrm not like '%not authorized%' then raise; end if; end;
  begin perform op_acknowledge_alert(gen_random_uuid());
  exception when others then if sqlerrm not like '%not authorized%' then raise; end if; end;
  begin perform op_resolve_alert(gen_random_uuid());
  exception when others then if sqlerrm not like '%not authorized%' then raise; end if; end;
end $$;
