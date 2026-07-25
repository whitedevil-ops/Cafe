-- ============================================================================
-- 0079 — Multi-admin roles & permissions for the platform-admin panel.
--
-- Before this migration, platform_admins.role was a free-text column that
-- was never actually read anywhere — is_platform_admin() treats ANY active
-- row as a full admin regardless of its role value. This migration makes
-- role real: five fixed roles with spec'd default permission sets, plus a
-- per-admin `permissions` jsonb for named overrides — the exact same
-- "override beats default" shape already used by cafe_feature_overrides /
-- cafe_has_feature, just at the admin layer instead of the café layer.
--
-- Every existing op_* mutation RPC is retrofitted below to check a specific
-- permission via has_platform_permission() instead of the old blanket
-- is_platform_admin(). Bodies are otherwise byte-for-byte identical to their
-- last definition (0019/0020/0021) — only the authorization line changes —
-- so no client call site needs to change for those.
--
-- platform_admins itself keeps having NO insert/update/delete RLS policy.
-- That is deliberate and unchanged: every write below goes through a
-- SECURITY DEFINER RPC that re-validates the caller's permission itself, so
-- there is no path — table policy or otherwise — for a session to write its
-- own admin row.
-- ============================================================================

-- ── 1. Schema: make platform_admins a real roster, not just a boolean flag ──
alter table platform_admins add column if not exists full_name text not null default '';
alter table platform_admins add column if not exists email text;
alter table platform_admins add column if not exists permissions jsonb not null default '{}'::jsonb;
alter table platform_admins add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table platform_admins add column if not exists updated_at timestamptz not null default now();

do $$ begin
  alter table platform_admins add constraint platform_admins_role_chk
    check (role in ('super_admin', 'operations_admin', 'support_admin', 'billing_admin', 'read_only'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table platform_admins add constraint platform_admins_status_chk2
    check (status in ('active', 'disabled', 'suspended'));
exception when duplicate_object then null; end $$;

-- Backfill the admin(s) bootstrapped by hand before this migration existed —
-- email from auth.users (always present), full_name from profiles if the
-- admin also happens to be a registered café user, else the email's local
-- part so the column is never blank in the UI.
update platform_admins pa
set email = u.email
from auth.users u
where pa.user_id = u.id and pa.email is null;

update platform_admins pa
set full_name = coalesce(nullif(p.full_name, ''), split_part(pa.email, '@', 1))
from profiles p
where pa.user_id = p.id and pa.full_name = '';

update platform_admins set full_name = split_part(email, '@', 1) where full_name = '' and email is not null;

-- ── 2. Permission model ─────────────────────────────────────────────────────
-- The 15 named permissions from the spec's "CUSTOM PERMISSIONS" section.
-- Fixed role defaults below map 1:1 to the spec's per-role checklists;
-- role_default_permissions() is the single place that mapping lives.
create or replace function role_default_permissions(p_role text)
returns jsonb language sql immutable as $$
  select case p_role
    when 'super_admin' then jsonb_build_object(
      'cafes.view', true, 'cafes.verify', true, 'cafes.edit', true, 'cafes.suspend', true,
      'users.view', true, 'health.view', true,
      'plans.view', true, 'plans.change', true, 'subscriptions.view', true, 'subscriptions.manage', true,
      'audit.view', true,
      'admins.view', true, 'admins.create', true, 'admins.edit', true, 'admins.disable', true
    )
    when 'operations_admin' then jsonb_build_object(
      'cafes.view', true, 'cafes.verify', true, 'cafes.edit', true, 'cafes.suspend', false,
      'users.view', true, 'health.view', true,
      'plans.view', false, 'plans.change', false, 'subscriptions.view', false, 'subscriptions.manage', false,
      'audit.view', false,
      'admins.view', false, 'admins.create', false, 'admins.edit', false, 'admins.disable', false
    )
    when 'support_admin' then jsonb_build_object(
      'cafes.view', true, 'cafes.verify', false, 'cafes.edit', false, 'cafes.suspend', false,
      'users.view', true, 'health.view', true,
      'plans.view', false, 'plans.change', false, 'subscriptions.view', false, 'subscriptions.manage', false,
      'audit.view', false,
      'admins.view', false, 'admins.create', false, 'admins.edit', false, 'admins.disable', false
    )
    when 'billing_admin' then jsonb_build_object(
      'cafes.view', true, 'cafes.verify', false, 'cafes.edit', false, 'cafes.suspend', false,
      'users.view', false, 'health.view', false,
      'plans.view', true, 'plans.change', true, 'subscriptions.view', true, 'subscriptions.manage', true,
      'audit.view', false,
      'admins.view', false, 'admins.create', false, 'admins.edit', false, 'admins.disable', false
    )
    when 'read_only' then jsonb_build_object(
      'cafes.view', true, 'cafes.verify', false, 'cafes.edit', false, 'cafes.suspend', false,
      'users.view', true, 'health.view', true,
      'plans.view', true, 'plans.change', false, 'subscriptions.view', true, 'subscriptions.manage', false,
      'audit.view', false,
      'admins.view', false, 'admins.create', false, 'admins.edit', false, 'admins.disable', false
    )
    else '{}'::jsonb
  end;
$$;

-- Per-admin `permissions` holds ONLY explicit overrides (sparse — a present
-- key wins over the role default, an absent key falls through to it), so
-- granting one extra permission to one admin never means hand-maintaining
-- their entire permission set.
create or replace function has_platform_permission(p_permission text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_admin platform_admins%rowtype;
  v_override text;
begin
  select * into v_admin from platform_admins where user_id = auth.uid() and status = 'active';
  if v_admin.id is null then return false; end if;

  v_override := v_admin.permissions ->> p_permission;
  if v_override is not null then return v_override::boolean; end if;

  return coalesce((role_default_permissions(v_admin.role) ->> p_permission)::boolean, false);
end $$;

revoke execute on function has_platform_permission(text) from public, anon;
grant execute on function has_platform_permission(text) to authenticated;

-- What the UI needs to render itself: own identity + fully-resolved (role
-- default merged with override) permission set in one call.
create or replace function platform_admin_context()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_admin platform_admins%rowtype;
begin
  select * into v_admin from platform_admins where user_id = auth.uid() and status = 'active';
  if v_admin.id is null then return null; end if;

  return jsonb_build_object(
    'admin_id', v_admin.id,
    'role', v_admin.role,
    'full_name', v_admin.full_name,
    'email', v_admin.email,
    'permissions', role_default_permissions(v_admin.role) || v_admin.permissions
  );
end $$;

revoke execute on function platform_admin_context() from public, anon;
grant execute on function platform_admin_context() to authenticated;

-- Every admin can mark their own login, regardless of any permission —
-- this is not a privileged action, it only ever touches the caller's own row.
create or replace function op_touch_admin_login()
returns void language plpgsql security definer set search_path = public as $$
begin
  update platform_admins set last_login_at = now() where user_id = auth.uid() and status = 'active';
end $$;

revoke execute on function op_touch_admin_login() from public, anon;
grant execute on function op_touch_admin_login() to authenticated;

-- ── 3. Table-level policies tightened from blanket "any admin" to the
--    specific view permission a raw client-side query actually needs. RPCs
--    below are unaffected (SECURITY DEFINER bypasses RLS on the tables they
--    touch internally) — this only closes the gap where a client queries a
--    table directly instead of going through an RPC. ─────────────────────
drop policy if exists "admin read" on platform_audit_logs;
create policy "admin read" on platform_audit_logs for select using (has_platform_permission('audit.view'));

drop policy if exists "platform admin read" on cafes;
create policy "platform admin read" on cafes for select using (has_platform_permission('cafes.view'));

drop policy if exists "platform admin read" on profiles;
create policy "platform admin read" on profiles for select using (has_platform_permission('users.view'));

drop policy if exists "platform admin read" on cafe_members;
create policy "platform admin read" on cafe_members for select using (has_platform_permission('cafes.view'));

drop policy if exists "admin read" on platform_admins;
create policy "admin read" on platform_admins for select using (has_platform_permission('admins.view'));

-- ── 4. Retrofit existing operator RPCs: same signature, same body, only the
--    authorization line changes from is_platform_admin() to a specific
--    has_platform_permission(). ─────────────────────────────────────────────
create or replace function op_platform_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_month_start timestamptz := date_trunc('month', now());
  v_today_start timestamptz := date_trunc('day', now());
  v_result jsonb;
begin
  -- Every role includes "Overview" per spec — gate on admin status only.
  if not is_platform_admin() then raise exception 'not authorized'; end if;

  select jsonb_build_object(
    'total_cafes', (select count(*) from cafes),
    'active_cafes', (select count(*) from cafes where status = 'active'),
    'verified_cafes', (select count(*) from cafes where verified),
    'unverified_cafes', (select count(*) from cafes where not verified),
    'trial_cafes', (select count(*) from cafes where plan = 'trial'),
    'suspended_cafes', (select count(*) from cafes where status = 'suspended'),
    'disabled_cafes', (select count(*) from cafes where status = 'disabled'),
    'archived_cafes', (select count(*) from cafes where status = 'archived'),
    'total_orders', (select count(*) from orders where status <> 'cancelled'),
    'total_customers', (select count(*) from customers),
    'new_cafes_this_month', (select count(*) from cafes where created_at >= v_month_start),
    'active_cafes_today', (select count(distinct cafe_id) from orders where created_at >= v_today_start and status <> 'cancelled'),
    'expiring_7', (select count(*) from cafes where subscription_ends_at between now() and now() + interval '7 days'),
    'expiring_15', (select count(*) from cafes where subscription_ends_at between now() and now() + interval '15 days'),
    'expiring_30', (select count(*) from cafes where subscription_ends_at between now() and now() + interval '30 days'),
    'plan_breakdown', (
      select coalesce(jsonb_agg(jsonb_build_object('plan', plan, 'count', cnt) order by cnt desc), '[]'::jsonb)
      from (select plan, count(*) cnt from cafes group by plan) x
    ),
    'recent_registrations', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'city', city, 'plan', plan, 'created_at', created_at
      ) order by created_at desc), '[]'::jsonb)
      from (select id, name, city, plan, created_at from cafes order by created_at desc limit 10) x
    ),
    'recent_activity', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'action', action, 'target_type', target_type, 'created_at', created_at
      ) order by created_at desc), '[]'::jsonb)
      from (select action, target_type, created_at from platform_audit_logs order by created_at desc limit 10) x
    )
  ) into v_result;

  return v_result;
end $$;

create or replace function op_list_cafes(
  p_search  text default null,
  p_status  text default null,
  p_verified boolean default null,
  p_plan    text default null,
  p_from    timestamptz default null,
  p_to      timestamptz default null
) returns table (
  cafe_id uuid, name text, city text, phone text, plan text, verified boolean,
  status text, created_at timestamptz, owner_name text, owner_email text, owner_phone text,
  staff_count bigint, orders_count bigint, last_order_at timestamptz,
  menu_items_count bigint, tables_count bigint, customers_count bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_platform_permission('cafes.view') then raise exception 'not authorized'; end if;

  return query
  select
    c.id, c.name, c.city, c.phone, c.plan, c.verified, c.status, c.created_at,
    p.full_name, p.email, p.phone,
    (select count(*) from cafe_members cm where cm.cafe_id = c.id and cm.status = 'active'),
    (select count(*) from orders o where o.cafe_id = c.id and o.status <> 'cancelled'),
    (select max(o.created_at) from orders o where o.cafe_id = c.id and o.status <> 'cancelled'),
    (select count(*) from menu_items mi where mi.cafe_id = c.id),
    (select count(*) from cafe_tables ct where ct.cafe_id = c.id),
    (select count(*) from customers cu where cu.cafe_id = c.id)
  from cafes c
  left join profiles p on p.id = c.owner_id
  where (p_status is null or c.status = p_status)
    and (p_verified is null or c.verified = p_verified)
    and (p_plan is null or c.plan = p_plan)
    and (p_from is null or c.created_at >= p_from)
    and (p_to is null or c.created_at <= p_to)
    and (
      p_search is null or p_search = '' or
      c.name ilike '%' || p_search || '%' or
      c.id::text = p_search or
      c.phone ilike '%' || p_search || '%' or
      p.full_name ilike '%' || p_search || '%' or
      p.email ilike '%' || p_search || '%'
    )
  order by c.created_at desc;
end $$;

create or replace function op_get_cafe_detail(p_cafe_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
  v_plan_key text;
  v_plan_features jsonb;
begin
  if not has_platform_permission('cafes.view') then raise exception 'not authorized'; end if;

  select plan into v_plan_key from cafes where id = p_cafe_id;
  if v_plan_key is null then raise exception 'cafe not found'; end if;
  select features into v_plan_features from platform_plans where key = v_plan_key;

  select jsonb_build_object(
    'business', (
      select jsonb_build_object(
        'id', c.id, 'name', c.name, 'logo_url', c.logo_url, 'owner_name', p.full_name,
        'owner_email', p.email, 'owner_phone', p.phone, 'phone', c.phone, 'address', c.address,
        'city', c.city, 'state', c.state, 'pincode', c.pincode, 'gstin', c.gstin, 'created_at', c.created_at
      )
      from cafes c left join profiles p on p.id = c.owner_id where c.id = p_cafe_id
    ),
    'account', (
      select jsonb_build_object(
        'status', status, 'status_reason', status_reason, 'status_changed_at', status_changed_at,
        'verified', verified, 'verified_at', verified_at, 'plan', plan,
        'trial_ends_at', trial_ends_at, 'subscription_ends_at', subscription_ends_at
      )
      from cafes where id = p_cafe_id
    ),
    'usage', jsonb_build_object(
      'staff_count', (select count(*) from cafe_members where cafe_id = p_cafe_id and status = 'active'),
      'menu_items_count', (select count(*) from menu_items where cafe_id = p_cafe_id),
      'tables_count', (select count(*) from cafe_tables where cafe_id = p_cafe_id),
      'customers_count', (select count(*) from customers where cafe_id = p_cafe_id),
      'orders_count', (select count(*) from orders where cafe_id = p_cafe_id and status <> 'cancelled'),
      'last_order_at', (select max(created_at) from orders where cafe_id = p_cafe_id and status <> 'cancelled')
    ),
    'onboarding', (
      select to_jsonb(o) from v_cafe_onboarding o where cafe_id = p_cafe_id
    ),
    'features', jsonb_build_object(
      'plan_defaults', coalesce(v_plan_features, '{}'::jsonb),
      'overrides', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'feature_key', feature_key, 'enabled', enabled, 'set_at', set_at
        ) order by feature_key), '[]'::jsonb)
        from cafe_feature_overrides where cafe_id = p_cafe_id
      )
    ),
    'notes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', n.id, 'note', n.note, 'created_by_name', p.full_name, 'created_at', n.created_at
      ) order by n.created_at desc), '[]'::jsonb)
      from operator_notes n left join profiles p on p.id = n.created_by where n.cafe_id = p_cafe_id
    ),
    'recent_audit', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'action', a.action, 'previous_value', a.previous_value, 'new_value', a.new_value,
        'created_at', a.created_at, 'actor_name', p.full_name
      ) order by a.created_at desc), '[]'::jsonb)
      from (select * from platform_audit_logs where target_type = 'cafe' and target_id = p_cafe_id order by created_at desc limit 20) a
      left join profiles p on p.id = a.actor_id
    )
  ) into v_result;

  return v_result;
end $$;

create or replace function op_cafe_health()
returns table (
  cafe_id uuid, name text, status text,
  days_since_last_order integer, onboarding_percent integer,
  failed_sms_count bigint, days_until_expiry integer
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_platform_permission('health.view') then raise exception 'not authorized'; end if;

  return query
  select
    c.id, c.name, c.status,
    (extract(day from now() - lo.last_order))::int as days_since_last_order,
    round((
      (o.account_created::int + o.profile_completed::int + o.menu_added::int + o.tables_created::int +
       o.qr_generated::int + o.staff_added::int + o.first_order_placed::int) * 100.0 / 7
    ))::int as onboarding_percent,
    coalesce(sms.failed_count, 0) as failed_sms_count,
    case when c.subscription_ends_at is null then null
         else (extract(day from c.subscription_ends_at - now()))::int end as days_until_expiry
  from cafes c
  left join v_cafe_onboarding o on o.cafe_id = c.id
  left join (select cafe_id, max(created_at) last_order from orders where status <> 'cancelled' group by cafe_id) lo on lo.cafe_id = c.id
  left join (select cafe_id, count(*) failed_count from sms_logs where status = 'failed' group by cafe_id) sms on sms.cafe_id = c.id
  where c.status <> 'archived'
  order by c.name;
end $$;

create or replace function op_verify_cafe(p_cafe_id uuid, p_verified boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_before jsonb;
begin
  if not has_platform_permission('cafes.verify') then raise exception 'not authorized'; end if;
  select jsonb_build_object('verified', verified) into v_before from cafes where id = p_cafe_id;
  if v_before is null then raise exception 'cafe not found'; end if;

  update cafes set
    verified = p_verified,
    verified_by = case when p_verified then auth.uid() else null end,
    verified_at = case when p_verified then now() else null end
  where id = p_cafe_id;

  insert into platform_audit_logs (actor_id, action, target_type, target_id, previous_value, new_value)
  values (auth.uid(), case when p_verified then 'cafe.verified' else 'cafe.unverified' end,
          'cafe', p_cafe_id, v_before, jsonb_build_object('verified', p_verified));
end $$;

create or replace function op_set_cafe_status(p_cafe_id uuid, p_status text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_before text;
begin
  if not has_platform_permission('cafes.suspend') then raise exception 'not authorized'; end if;
  if p_status not in ('active', 'suspended', 'disabled', 'archived') then raise exception 'invalid status'; end if;
  if p_reason is null or trim(p_reason) = '' then raise exception 'a reason is required'; end if;

  select status into v_before from cafes where id = p_cafe_id;
  if v_before is null then raise exception 'cafe not found'; end if;

  update cafes set status = p_status, status_reason = trim(p_reason),
                  status_changed_at = now(), status_changed_by = auth.uid()
  where id = p_cafe_id;

  insert into platform_audit_logs (actor_id, action, target_type, target_id, previous_value, new_value)
  values (auth.uid(), 'cafe.status_changed', 'cafe', p_cafe_id,
          jsonb_build_object('status', v_before),
          jsonb_build_object('status', p_status, 'reason', trim(p_reason)));
end $$;

create or replace function op_change_plan(p_cafe_id uuid, p_plan_key text)
returns void language plpgsql security definer set search_path = public as $$
declare v_before text; v_exists boolean;
begin
  if not has_platform_permission('plans.change') then raise exception 'not authorized'; end if;
  select exists(select 1 from platform_plans where key = p_plan_key and active) into v_exists;
  if not v_exists then raise exception 'unknown or inactive plan: %', p_plan_key; end if;

  select plan into v_before from cafes where id = p_cafe_id;
  if v_before is null then raise exception 'cafe not found'; end if;

  update cafes set plan = p_plan_key where id = p_cafe_id;

  insert into platform_audit_logs (actor_id, action, target_type, target_id, previous_value, new_value)
  values (auth.uid(), 'cafe.plan_changed', 'cafe', p_cafe_id,
          jsonb_build_object('plan', v_before), jsonb_build_object('plan', p_plan_key));
end $$;

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
                  trial_ends_at = coalesce(p_trial_ends_at, trial_ends_at)
  where id = p_cafe_id;

  insert into platform_audit_logs (actor_id, action, target_type, target_id, previous_value, new_value)
  values (auth.uid(), 'cafe.subscription_extended', 'cafe', p_cafe_id, v_before,
          jsonb_build_object('subscription_ends_at', p_subscription_ends_at));
end $$;

create or replace function op_set_feature_override(p_cafe_id uuid, p_feature_key text, p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_before boolean;
begin
  if not has_platform_permission('cafes.edit') then raise exception 'not authorized'; end if;
  select enabled into v_before from cafe_feature_overrides where cafe_id = p_cafe_id and feature_key = p_feature_key;

  insert into cafe_feature_overrides (cafe_id, feature_key, enabled, set_by)
  values (p_cafe_id, p_feature_key, p_enabled, auth.uid())
  on conflict (cafe_id, feature_key) do update set enabled = p_enabled, set_by = auth.uid(), set_at = now();

  insert into platform_audit_logs (actor_id, action, target_type, target_id, previous_value, new_value)
  values (auth.uid(), 'cafe.feature_override_changed', 'cafe', p_cafe_id,
          jsonb_build_object('feature', p_feature_key, 'enabled', v_before),
          jsonb_build_object('feature', p_feature_key, 'enabled', p_enabled));
end $$;

create or replace function op_clear_feature_override(p_cafe_id uuid, p_feature_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_platform_permission('cafes.edit') then raise exception 'not authorized'; end if;
  delete from cafe_feature_overrides where cafe_id = p_cafe_id and feature_key = p_feature_key;
  insert into platform_audit_logs (actor_id, action, target_type, target_id, new_value)
  values (auth.uid(), 'cafe.feature_override_cleared', 'cafe', p_cafe_id, jsonb_build_object('feature', p_feature_key));
end $$;

create or replace function op_add_operator_note(p_cafe_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_platform_permission('cafes.edit') then raise exception 'not authorized'; end if;
  if p_note is null or trim(p_note) = '' then raise exception 'note cannot be empty'; end if;
  insert into operator_notes (cafe_id, note, created_by) values (p_cafe_id, trim(p_note), auth.uid());
  insert into platform_audit_logs (actor_id, action, target_type, target_id, new_value)
  values (auth.uid(), 'cafe.note_added', 'cafe', p_cafe_id, jsonb_build_object('note', trim(p_note)));
end $$;

create or replace function op_log_password_reset(
  p_cafe_id uuid, p_target_user_id uuid, p_target_email text, p_status text, p_error text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_platform_permission('cafes.edit') then raise exception 'not authorized'; end if;

  insert into password_reset_log (cafe_id, target_user_id, target_email, initiated_by, status, error)
  values (p_cafe_id, p_target_user_id, p_target_email, auth.uid(), p_status, p_error);

  insert into platform_audit_logs (actor_id, action, target_type, target_id, new_value)
  values (auth.uid(), 'cafe.password_reset_initiated', 'cafe', p_cafe_id,
          jsonb_build_object('target_email', p_target_email, 'status', p_status));
end $$;

-- ── 5. Admin management RPCs ────────────────────────────────────────────────
create or replace function op_list_admins()
returns table (
  admin_id uuid, user_id uuid, full_name text, email text, role text,
  status text, last_login_at timestamptz, created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_platform_permission('admins.view') then raise exception 'not authorized'; end if;

  return query
  select pa.id, pa.user_id, pa.full_name, pa.email, pa.role, pa.status, pa.last_login_at, pa.created_at
  from platform_admins pa
  order by pa.created_at desc;
end $$;

create or replace function op_get_admin_detail(p_admin_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_admin platform_admins%rowtype;
  v_result jsonb;
begin
  if not has_platform_permission('admins.view') then raise exception 'not authorized'; end if;

  select * into v_admin from platform_admins where id = p_admin_id;
  if v_admin.id is null then raise exception 'admin not found'; end if;

  select jsonb_build_object(
    'admin_id', v_admin.id, 'user_id', v_admin.user_id, 'full_name', v_admin.full_name,
    'email', v_admin.email, 'role', v_admin.role, 'status', v_admin.status,
    'last_login_at', v_admin.last_login_at, 'created_at', v_admin.created_at,
    'permissions', v_admin.permissions,
    'effective_permissions', role_default_permissions(v_admin.role) || v_admin.permissions,
    'recent_activity', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'action', a.action, 'target_type', a.target_type, 'target_id', a.target_id,
        'previous_value', a.previous_value, 'new_value', a.new_value, 'created_at', a.created_at
      ) order by a.created_at desc), '[]'::jsonb)
      from (
        select * from platform_audit_logs where actor_id = v_admin.user_id order by created_at desc limit 50
      ) a
    )
  ) into v_result;

  return v_result;
end $$;

-- Records the roster row only. The auth.users account itself is created by
-- the /api/platform-admin/admins/create route via the service-role admin
-- API (needs SUPABASE_SERVICE_ROLE_KEY — that route is env-gated and fails
-- cleanly if it isn't configured); this RPC never sees a password.
create or replace function op_create_admin(
  p_user_id uuid, p_full_name text, p_email text, p_role text, p_permissions jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_caller_role text;
  v_new_id uuid;
begin
  if not has_platform_permission('admins.create') then raise exception 'not authorized'; end if;
  if p_role not in ('super_admin', 'operations_admin', 'support_admin', 'billing_admin', 'read_only') then
    raise exception 'invalid role: %', p_role;
  end if;
  if p_full_name is null or trim(p_full_name) = '' then raise exception 'full name is required'; end if;
  if p_email is null or trim(p_email) = '' then raise exception 'email is required'; end if;

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
          jsonb_build_object('full_name', trim(p_full_name), 'email', lower(trim(p_email)), 'role', p_role));

  return v_new_id;
end $$;

-- Edit Admin: name + role together (role changes carry the escalation and
-- last-super-admin guards; a pure name edit skips them and logs distinctly).
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
  if p_role not in ('super_admin', 'operations_admin', 'support_admin', 'billing_admin', 'read_only') then
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

-- Change Permissions: replaces the admin's override set wholesale — the UI
-- sends the complete desired set of overrides, not a delta.
create or replace function op_update_admin_permissions(p_admin_id uuid, p_permissions jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_target platform_admins%rowtype;
  v_caller_admin_id uuid;
  v_key text;
  v_allowed text[] := array[
    'cafes.view','cafes.verify','cafes.edit','cafes.suspend',
    'users.view','health.view',
    'plans.view','plans.change','subscriptions.view','subscriptions.manage',
    'audit.view',
    'admins.view','admins.create','admins.edit','admins.disable'
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
  end loop;

  update platform_admins set permissions = coalesce(p_permissions, '{}'::jsonb), updated_at = now() where id = p_admin_id;

  insert into platform_audit_logs (actor_id, action, target_type, target_id, previous_value, new_value)
  values (auth.uid(), 'admin.permissions_changed', 'admin', p_admin_id, v_target.permissions, p_permissions);
end $$;

create or replace function op_set_admin_status(p_admin_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_target platform_admins%rowtype;
  v_caller_admin_id uuid;
  v_other_active_supers integer;
begin
  if not has_platform_permission('admins.disable') then raise exception 'not authorized'; end if;
  if p_status not in ('active', 'disabled') then raise exception 'invalid status'; end if;

  select id into v_caller_admin_id from platform_admins where user_id = auth.uid() and status = 'active';
  select * into v_target from platform_admins where id = p_admin_id;
  if v_target.id is null then raise exception 'admin not found'; end if;

  if v_target.id = v_caller_admin_id then
    raise exception 'you cannot deactivate your own account';
  end if;

  if v_target.role = 'super_admin' and v_target.status = 'active' and p_status = 'disabled' then
    select count(*) into v_other_active_supers
    from platform_admins where role = 'super_admin' and status = 'active' and id <> v_target.id;
    if v_other_active_supers = 0 then
      raise exception 'cannot disable the last active super admin';
    end if;
  end if;

  update platform_admins set status = p_status, updated_at = now() where id = p_admin_id;

  insert into platform_audit_logs (actor_id, action, target_type, target_id, previous_value, new_value)
  values (auth.uid(), 'admin.status_changed', 'admin', p_admin_id,
          jsonb_build_object('status', v_target.status), jsonb_build_object('status', p_status));
end $$;

-- Same shape as op_log_password_reset (cafe owners): the actual reset uses
-- Supabase Auth's own resetPasswordForEmail() magic-link flow from the API
-- route. This RPC only records that an operator initiated one — no password
-- of any kind is ever seen, generated, or stored here.
create or replace function op_log_admin_password_reset(p_admin_id uuid, p_target_email text, p_status text, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_target_user_id uuid;
begin
  if not has_platform_permission('admins.edit') then raise exception 'not authorized'; end if;

  select user_id into v_target_user_id from platform_admins where id = p_admin_id;
  if v_target_user_id is null then raise exception 'admin not found'; end if;

  insert into password_reset_log (cafe_id, target_user_id, target_email, initiated_by, status, error)
  values (null, v_target_user_id, p_target_email, auth.uid(), p_status, p_error);

  insert into platform_audit_logs (actor_id, action, target_type, target_id, new_value)
  values (auth.uid(), 'admin.password_reset_initiated', 'admin', p_admin_id,
          jsonb_build_object('target_email', p_target_email, 'status', p_status));
end $$;

revoke execute on function op_list_admins() from public, anon;
revoke execute on function op_get_admin_detail(uuid) from public, anon;
revoke execute on function op_create_admin(uuid, text, text, text, jsonb) from public, anon;
revoke execute on function op_update_admin(uuid, text, text) from public, anon;
revoke execute on function op_update_admin_permissions(uuid, jsonb) from public, anon;
revoke execute on function op_set_admin_status(uuid, text) from public, anon;
revoke execute on function op_log_admin_password_reset(uuid, text, text, text) from public, anon;

grant execute on function op_list_admins() to authenticated;
grant execute on function op_get_admin_detail(uuid) to authenticated;
grant execute on function op_create_admin(uuid, text, text, text, jsonb) to authenticated;
grant execute on function op_update_admin(uuid, text, text) to authenticated;
grant execute on function op_update_admin_permissions(uuid, jsonb) to authenticated;
grant execute on function op_set_admin_status(uuid, text) to authenticated;
grant execute on function op_log_admin_password_reset(uuid, text, text, text) to authenticated;
