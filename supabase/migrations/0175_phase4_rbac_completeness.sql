-- ============================================================================
-- Phase 4 — RBAC Completeness. Three changes bundled into ONE migration
-- because all three edit the same role_default_permissions() /
-- op_update_admin_permissions() / op_create_admin() trio, and CREATE OR
-- REPLACE is a full replacement, not a diff — shipping them as separate
-- migrations means whichever runs last silently erases the others' changes.
-- This exact failure mode has already happened three times in this codebase
-- (0102->0117->0134, motivating 0142's fix) and a fourth time was caught
-- and avoided here before it shipped.
--
-- 1. Sales Admin role — leads.view + leads.manage + cafes.view (read-only)
--    only, per the master spec. "Café registration" (creating a cafes row
--    directly from a lead) has no backing RPC anywhere in this codebase
--    (confirmed by repo-wide grep) — NOT built here; that is its own,
--    larger feature. No new permission key needed for this role — it uses
--    only pre-existing keys.
--
-- 2. Operations Admin gets plans.view/plans.change/subscriptions.view/
--    subscriptions.manage = true (was false on all four). Every other role
--    in this function always moves the {plans.view, subscriptions.view}
--    and {plans.change, subscriptions.manage} pairs together — never split
--    — and Operations Admin already does "café management broadly"
--    (cafes.edit=true). Splitting the pair for this one role would be an
--    unprecedented first, not a continuation of an existing pattern.
--
-- 3. New permission key cafes.reset_password, separate from cafes.edit, so
--    Support Admin can use the "Reset owner password" action the master
--    spec explicitly lists for that role without also getting full café
--    edit rights. Granted true to every role that already has
--    cafes.edit=true (super_admin, operations_admin) PLUS support_admin.
--    op_log_password_reset — the RPC that ACTUALLY performs the logged
--    write, one layer below the route-level check — must be re-bodied to
--    the same key too, or a support_admin's reset email sends successfully
--    but the logging call throws 'not authorized', producing a false
--    "failed" toast for an action that actually worked, with the audit
--    trail silently never getting the row.
--
-- All three role_default_permissions() branches unrelated to these changes,
-- and every other line, are copied verbatim from 0172_alert_centre.sql (the
-- confirmed current body) — not reconstructed from memory or an older
-- migration.
-- ============================================================================

-- ── 1. Widen the role CHECK constraint for sales_admin ─────────────────────
alter table platform_admins drop constraint if exists platform_admins_role_chk;
alter table platform_admins add constraint platform_admins_role_chk
  check (role in ('super_admin', 'operations_admin', 'support_admin', 'billing_admin', 'read_only', 'sales_admin'));

-- ── 2. role_default_permissions — all three changes combined ───────────────
create or replace function role_default_permissions(p_role text)
returns jsonb language sql immutable as $$
  select case p_role
    when 'super_admin' then jsonb_build_object(
      'cafes.view', true, 'cafes.verify', true, 'cafes.edit', true, 'cafes.reset_password', true, 'cafes.suspend', true,
      'cafes.delete', true, 'cafes.impersonate', true,
      'users.view', true, 'health.view', true, 'alerts.view', true, 'alerts.manage', true,
      'plans.view', true, 'plans.change', true, 'subscriptions.view', true, 'subscriptions.manage', true,
      'audit.view', true,
      'admins.view', true, 'admins.create', true, 'admins.edit', true, 'admins.disable', true,
      'leads.view', true, 'leads.manage', true
    )
    when 'operations_admin' then jsonb_build_object(
      'cafes.view', true, 'cafes.verify', true, 'cafes.edit', true, 'cafes.reset_password', true, 'cafes.suspend', false,
      'cafes.delete', false, 'cafes.impersonate', false,
      'users.view', true, 'health.view', true, 'alerts.view', true, 'alerts.manage', true,
      'plans.view', true, 'plans.change', true, 'subscriptions.view', true, 'subscriptions.manage', true,
      'audit.view', false,
      'admins.view', false, 'admins.create', false, 'admins.edit', false, 'admins.disable', false,
      'leads.view', true, 'leads.manage', false
    )
    when 'support_admin' then jsonb_build_object(
      'cafes.view', true, 'cafes.verify', false, 'cafes.edit', false, 'cafes.reset_password', true, 'cafes.suspend', false,
      'cafes.delete', false, 'cafes.impersonate', false,
      'users.view', true, 'health.view', true, 'alerts.view', true, 'alerts.manage', false,
      'plans.view', false, 'plans.change', false, 'subscriptions.view', false, 'subscriptions.manage', false,
      'audit.view', false,
      'admins.view', false, 'admins.create', false, 'admins.edit', false, 'admins.disable', false,
      'leads.view', false, 'leads.manage', false
    )
    when 'billing_admin' then jsonb_build_object(
      'cafes.view', true, 'cafes.verify', false, 'cafes.edit', false, 'cafes.reset_password', false, 'cafes.suspend', false,
      'cafes.delete', false, 'cafes.impersonate', false,
      'users.view', false, 'health.view', false, 'alerts.view', false, 'alerts.manage', false,
      'plans.view', true, 'plans.change', true, 'subscriptions.view', true, 'subscriptions.manage', true,
      'audit.view', false,
      'admins.view', false, 'admins.create', false, 'admins.edit', false, 'admins.disable', false,
      'leads.view', false, 'leads.manage', false
    )
    when 'read_only' then jsonb_build_object(
      'cafes.view', true, 'cafes.verify', false, 'cafes.edit', false, 'cafes.reset_password', false, 'cafes.suspend', false,
      'cafes.delete', false, 'cafes.impersonate', false,
      'users.view', true, 'health.view', true, 'alerts.view', true, 'alerts.manage', false,
      'plans.view', true, 'plans.change', false, 'subscriptions.view', true, 'subscriptions.manage', false,
      'audit.view', false,
      'admins.view', false, 'admins.create', false, 'admins.edit', false, 'admins.disable', false,
      'leads.view', true, 'leads.manage', false
    )
    when 'sales_admin' then jsonb_build_object(
      'cafes.view', true, 'cafes.verify', false, 'cafes.edit', false, 'cafes.reset_password', false, 'cafes.suspend', false,
      'cafes.delete', false, 'cafes.impersonate', false,
      'users.view', false, 'health.view', false, 'alerts.view', false, 'alerts.manage', false,
      'plans.view', false, 'plans.change', false, 'subscriptions.view', false, 'subscriptions.manage', false,
      'audit.view', false,
      'admins.view', false, 'admins.create', false, 'admins.edit', false, 'admins.disable', false,
      'leads.view', true, 'leads.manage', true
    )
    else '{}'::jsonb
  end;
$$;

-- ── 3. op_update_admin_permissions — v_allowed gains cafes.reset_password ──
create or replace function op_update_admin_permissions(p_admin_id uuid, p_permissions jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_target platform_admins%rowtype;
  v_caller_admin_id uuid;
  v_key text;
  v_allowed text[] := array[
    'cafes.view','cafes.verify','cafes.edit','cafes.reset_password','cafes.suspend','cafes.delete','cafes.impersonate',
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

-- ── 4. op_create_admin — v_allowed + cafes.reset_password + sales_admin ────
create or replace function op_create_admin(
  p_user_id uuid, p_full_name text, p_email text, p_role text, p_permissions jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_caller_role text;
  v_new_id uuid;
  v_key text;
  v_allowed text[] := array[
    'cafes.view','cafes.verify','cafes.edit','cafes.reset_password','cafes.suspend','cafes.delete','cafes.impersonate',
    'users.view','health.view','alerts.view','alerts.manage',
    'plans.view','plans.change','subscriptions.view','subscriptions.manage',
    'audit.view',
    'admins.view','admins.create','admins.edit','admins.disable',
    'leads.view','leads.manage'
  ];
begin
  if not has_platform_permission('admins.create') then raise exception 'not authorized'; end if;
  if p_role not in ('super_admin', 'operations_admin', 'support_admin', 'billing_admin', 'read_only', 'sales_admin') then
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

-- ── 5. op_update_admin — its own SEPARATE role allow-list (0079, never
--    touched by 0142/0172), needed so an existing admin's role can be
--    retargeted TO sales_admin via Edit Admin, not just set at creation.
--    Body otherwise byte-for-byte identical to 0079's definition. ──────────
create or replace function op_update_admin(p_admin_id uuid, p_full_name text, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_target platform_admins%rowtype;
  v_caller_admin_id uuid;
  v_caller_role text;
  v_other_active_supers integer;
begin
  if not has_platform_permission('admins.edit') then raise exception 'not authorized'; end if;
  if p_full_name is null or trim(p_full_name) = '' then raise exception 'full name is required'; end if;
  if p_role not in ('super_admin', 'operations_admin', 'support_admin', 'billing_admin', 'read_only', 'sales_admin') then
    raise exception 'invalid role: %', p_role;
  end if;

  select id, role into v_caller_admin_id, v_caller_role from platform_admins where user_id = auth.uid() and status = 'active';
  select * into v_target from platform_admins where id = p_admin_id;
  if v_target.id is null then raise exception 'admin not found'; end if;

  if v_target.id = v_caller_admin_id and v_target.role <> p_role then
    raise exception 'you cannot change your own role';
  end if;

  if p_role = 'super_admin' and v_target.role <> 'super_admin' and v_caller_role <> 'super_admin' then
    raise exception 'only a super admin can grant the super admin role';
  end if;

  if v_target.role = 'super_admin' and p_role <> 'super_admin' and v_target.status = 'active' then
    select count(*) into v_other_active_supers
    from platform_admins where role = 'super_admin' and status = 'active' and id <> v_target.id;
    if v_other_active_supers = 0 then
      raise exception 'cannot change the role of the last active super admin';
    end if;
  end if;

  update platform_admins set full_name = trim(p_full_name), role = p_role, updated_at = now() where id = p_admin_id;

  if v_target.role <> p_role then
    insert into platform_audit_logs (actor_id, action, target_type, target_id, previous_value, new_value)
    values (auth.uid(), 'admin.role_changed', 'admin', p_admin_id,
            jsonb_build_object('role', v_target.role), jsonb_build_object('role', p_role, 'full_name', trim(p_full_name)));
  else
    insert into platform_audit_logs (actor_id, action, target_type, target_id, previous_value, new_value)
    values (auth.uid(), 'admin.updated', 'admin', p_admin_id,
            jsonb_build_object('full_name', v_target.full_name), jsonb_build_object('full_name', trim(p_full_name)));
  end if;
end $$;

-- ── 6. op_log_password_reset — the hidden 4th gate. Same signature, no
--    arity change. Without this, a support_admin's reset email sends
--    successfully but this call throws 'not authorized', producing a false
--    "failed" toast and a missing audit-log row for an action that worked. ──
create or replace function op_log_password_reset(
  p_cafe_id uuid, p_target_user_id uuid, p_target_email text, p_status text, p_error text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_platform_permission('cafes.reset_password') then raise exception 'not authorized'; end if;

  insert into password_reset_log (cafe_id, target_user_id, target_email, initiated_by, status, error)
  values (p_cafe_id, p_target_user_id, p_target_email, auth.uid(), p_status, p_error);

  insert into platform_audit_logs (actor_id, action, target_type, target_id, new_value)
  values (auth.uid(), 'cafe.password_reset_initiated', 'cafe', p_cafe_id,
          jsonb_build_object('target_email', p_target_email, 'status', p_status));
end $$;

-- Consistency backstop -- real inserts always go through op_log_password_reset
-- (SECURITY DEFINER, bypasses RLS), so this isn't the enforcement point, but
-- it should still name the right permission for anyone auditing "does this
-- policy match its RPC".
drop policy if exists "admin insert" on password_reset_log;
create policy "admin insert" on password_reset_log for insert with check (has_platform_permission('cafes.reset_password'));

-- ── self-check ───────────────────────────────────────────────────────────
do $$
begin
  -- Sales Admin
  if coalesce((role_default_permissions('sales_admin') ->> 'leads.manage')::boolean, false) is distinct from true then
    raise exception 'role_default_permissions(sales_admin).leads.manage did not set to true';
  end if;
  if coalesce((role_default_permissions('sales_admin') ->> 'cafes.view')::boolean, false) is distinct from true then
    raise exception 'role_default_permissions(sales_admin).cafes.view did not set to true';
  end if;
  if coalesce((role_default_permissions('sales_admin') ->> 'cafes.edit')::boolean, false) is distinct from false then
    raise exception 'role_default_permissions(sales_admin).cafes.edit should be false';
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'platform_admins_role_chk'
      and pg_get_constraintdef(oid) like '%sales_admin%'
  ) then
    raise exception 'platform_admins_role_chk was not widened to include sales_admin';
  end if;

  -- Operations Admin subscriptions
  if coalesce((role_default_permissions('operations_admin') ->> 'subscriptions.manage')::boolean, false) is distinct from true then
    raise exception 'role_default_permissions(operations_admin).subscriptions.manage did not set to true';
  end if;
  if coalesce((role_default_permissions('operations_admin') ->> 'plans.change')::boolean, false) is distinct from true then
    raise exception 'role_default_permissions(operations_admin).plans.change did not set to true';
  end if;

  -- Reset-password permission
  if coalesce((role_default_permissions('support_admin') ->> 'cafes.reset_password')::boolean, false) is distinct from true then
    raise exception 'role_default_permissions(support_admin).cafes.reset_password did not set to true';
  end if;
  if coalesce((role_default_permissions('support_admin') ->> 'cafes.edit')::boolean, false) is distinct from false then
    raise exception 'role_default_permissions(support_admin).cafes.edit should remain false';
  end if;
  if coalesce((role_default_permissions('billing_admin') ->> 'cafes.reset_password')::boolean, false) is distinct from false then
    raise exception 'role_default_permissions(billing_admin).cafes.reset_password should be false';
  end if;

  -- Regression guards: unrelated pre-existing keys must survive this re-body
  if coalesce((role_default_permissions('super_admin') ->> 'alerts.manage')::boolean, false) is distinct from true then
    raise exception 'role_default_permissions(super_admin).alerts.manage regressed';
  end if;
  if coalesce((role_default_permissions('super_admin') ->> 'cafes.delete')::boolean, false) is distinct from true then
    raise exception 'role_default_permissions(super_admin).cafes.delete regressed';
  end if;
  if coalesce((role_default_permissions('billing_admin') ->> 'plans.change')::boolean, false) is distinct from true then
    raise exception 'role_default_permissions(billing_admin).plans.change regressed';
  end if;
  if coalesce((role_default_permissions('read_only') ->> 'leads.view')::boolean, false) is distinct from true then
    raise exception 'role_default_permissions(read_only).leads.view regressed';
  end if;
end $$;

-- Migrations run with no auth.uid(), so 'not authorized' is the expected,
-- successful outcome here -- same pattern as every prior migration's
-- self-check in this repo.
do $$
begin
  begin perform op_create_admin(gen_random_uuid(), 'x', 'x@x.com', 'sales_admin');
  exception when others then if sqlerrm not like '%not authorized%' then raise; end if; end;
  begin perform op_update_admin(gen_random_uuid(), 'x', 'sales_admin');
  exception when others then if sqlerrm not like '%not authorized%' then raise; end if; end;
  begin perform op_log_password_reset(gen_random_uuid(), gen_random_uuid(), 'x@x.com', 'sent');
  exception when others then if sqlerrm not like '%not authorized%' then raise; end if; end;
end $$;
