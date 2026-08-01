-- ============================================================================
-- 0117 — Leads instead of direct self-registration.
--
-- The public "Start free" CTA no longer takes a visitor straight into the
-- OTP self-serve signup flow (that flow — /signup, request-code/verify-code
-- — is untouched and still works, it's just no longer linked from marketing
-- pages). Instead it shows a short lead-capture form (name, phone, optional
-- business/city/email/message). Submitting it inserts a row here and emails
-- a configurable list of recipients — so a real person follows up and
-- decides whether/how to onboard them, rather than anyone being able to
-- create a live tenant unattended.
--
-- Two new tables, both RPC-only (no direct-select/insert RLS policy, same
-- posture as platform_admins): leads itself, and lead_notification_emails —
-- the platform-admin-editable list of who gets notified on a new lead.
-- ============================================================================

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text not null,
  email text,
  business_name text,
  city text,
  message text,
  status text not null default 'new' check (status in ('new', 'contacted', 'converted', 'dismissed')),
  source text not null default 'website',
  created_at timestamptz not null default now()
);

alter table leads enable row level security;

create table if not exists lead_notification_emails (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

alter table lead_notification_emails enable row level security;

insert into lead_notification_emails (email)
values ('originalblockbuster04@gmail.com'), ('vineet.sharma7876@gmail.com')
on conflict (email) do nothing;

-- ── Public entry point — called from the unauthenticated /get-started form.
-- Deliberately minimal validation (this is a lead, not an account: nothing
-- here can read or write any other table, so there's no privilege to abuse
-- beyond filling the leads table itself).
create or replace function submit_lead(
  p_full_name text, p_phone text, p_email text default null,
  p_business_name text default null, p_city text default null, p_message text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if p_full_name is null or trim(p_full_name) = '' then raise exception 'full name is required'; end if;
  if p_phone is null or trim(p_phone) = '' then raise exception 'phone number is required'; end if;

  insert into leads (full_name, phone, email, business_name, city, message)
  values (
    trim(p_full_name), trim(p_phone), nullif(trim(coalesce(p_email, '')), ''),
    nullif(trim(coalesce(p_business_name, '')), ''), nullif(trim(coalesce(p_city, '')), ''),
    nullif(trim(coalesce(p_message, '')), '')
  )
  returning id into v_id;

  return v_id;
end $$;

revoke execute on function submit_lead(text, text, text, text, text, text) from public;
grant execute on function submit_lead(text, text, text, text, text, text) to anon, authenticated;

-- ── Platform-admin: view/triage leads ───────────────────────────────────────
create or replace function op_list_leads()
returns table (
  id uuid, full_name text, phone text, email text, business_name text, city text,
  message text, status text, created_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if not has_platform_permission('leads.view') then raise exception 'not authorized'; end if;

  return query
  select l.id, l.full_name, l.phone, l.email, l.business_name, l.city, l.message, l.status, l.created_at
  from leads l
  order by l.created_at desc;
end $$;

create or replace function op_update_lead_status(p_lead_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare v_before text;
begin
  if not has_platform_permission('leads.view') then raise exception 'not authorized'; end if;
  if p_status not in ('new', 'contacted', 'converted', 'dismissed') then raise exception 'invalid status'; end if;

  select status into v_before from leads where id = p_lead_id;
  if v_before is null then raise exception 'lead not found'; end if;

  update leads set status = p_status where id = p_lead_id;

  insert into platform_audit_logs (actor_id, action, target_type, target_id, previous_value, new_value)
  values (auth.uid(), 'lead.status_changed', 'lead', p_lead_id,
          jsonb_build_object('status', v_before), jsonb_build_object('status', p_status));
end $$;

-- ── Platform-admin: who gets notified when a lead comes in ────────────────
create or replace function op_list_lead_notification_emails()
returns table (id uuid, email text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_platform_permission('leads.manage') then raise exception 'not authorized'; end if;

  return query
  select n.id, n.email, n.created_at from lead_notification_emails n order by n.created_at;
end $$;

create or replace function op_add_lead_notification_email(p_email text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_id uuid;
begin
  if not has_platform_permission('leads.manage') then raise exception 'not authorized'; end if;
  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'a valid email is required'; end if;

  insert into lead_notification_emails (email, created_by) values (v_email, auth.uid())
  on conflict (email) do nothing
  returning id into v_id;

  if v_id is null then raise exception 'that email is already on the list'; end if;

  insert into platform_audit_logs (actor_id, action, target_type, target_id, new_value)
  values (auth.uid(), 'lead_notification_email.added', 'lead_notification_email', v_id, jsonb_build_object('email', v_email));

  return v_id;
end $$;

create or replace function op_remove_lead_notification_email(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_count integer;
begin
  if not has_platform_permission('leads.manage') then raise exception 'not authorized'; end if;

  select count(*) into v_count from lead_notification_emails;
  if v_count <= 1 then raise exception 'cannot remove the last notification email'; end if;

  select email into v_email from lead_notification_emails where id = p_id;
  if v_email is null then raise exception 'not found'; end if;

  delete from lead_notification_emails where id = p_id;

  insert into platform_audit_logs (actor_id, action, target_type, target_id, previous_value)
  values (auth.uid(), 'lead_notification_email.removed', 'lead_notification_email', p_id, jsonb_build_object('email', v_email));
end $$;

revoke execute on function op_list_leads() from public, anon;
revoke execute on function op_update_lead_status(uuid, text) from public, anon;
revoke execute on function op_list_lead_notification_emails() from public, anon;
revoke execute on function op_add_lead_notification_email(text) from public, anon;
revoke execute on function op_remove_lead_notification_email(uuid) from public, anon;

grant execute on function op_list_leads() to authenticated;
grant execute on function op_update_lead_status(uuid, text) to authenticated;
grant execute on function op_list_lead_notification_emails() to authenticated;
grant execute on function op_add_lead_notification_email(text) to authenticated;
grant execute on function op_remove_lead_notification_email(uuid) to authenticated;

-- ── Wire the two new permission keys into the existing role/permission
-- model (0079/0116) — recreated verbatim from their last definition, plus
-- 'leads.view'/'leads.manage' in every branch / allowlist. super_admin gets
-- both; operations_admin and read_only get view-only (matching how they
-- already get view-only on cafés/users/health); support/billing admins get
-- neither (leads aren't their job). ─────────────────────────────────────────
create or replace function role_default_permissions(p_role text)
returns jsonb language sql immutable as $$
  select case p_role
    when 'super_admin' then jsonb_build_object(
      'cafes.view', true, 'cafes.verify', true, 'cafes.edit', true, 'cafes.suspend', true,
      'users.view', true, 'health.view', true,
      'plans.view', true, 'plans.change', true, 'subscriptions.view', true, 'subscriptions.manage', true,
      'audit.view', true,
      'admins.view', true, 'admins.create', true, 'admins.edit', true, 'admins.disable', true,
      'leads.view', true, 'leads.manage', true
    )
    when 'operations_admin' then jsonb_build_object(
      'cafes.view', true, 'cafes.verify', true, 'cafes.edit', true, 'cafes.suspend', false,
      'users.view', true, 'health.view', true,
      'plans.view', false, 'plans.change', false, 'subscriptions.view', false, 'subscriptions.manage', false,
      'audit.view', false,
      'admins.view', false, 'admins.create', false, 'admins.edit', false, 'admins.disable', false,
      'leads.view', true, 'leads.manage', false
    )
    when 'support_admin' then jsonb_build_object(
      'cafes.view', true, 'cafes.verify', false, 'cafes.edit', false, 'cafes.suspend', false,
      'users.view', true, 'health.view', true,
      'plans.view', false, 'plans.change', false, 'subscriptions.view', false, 'subscriptions.manage', false,
      'audit.view', false,
      'admins.view', false, 'admins.create', false, 'admins.edit', false, 'admins.disable', false,
      'leads.view', false, 'leads.manage', false
    )
    when 'billing_admin' then jsonb_build_object(
      'cafes.view', true, 'cafes.verify', false, 'cafes.edit', false, 'cafes.suspend', false,
      'users.view', false, 'health.view', false,
      'plans.view', true, 'plans.change', true, 'subscriptions.view', true, 'subscriptions.manage', true,
      'audit.view', false,
      'admins.view', false, 'admins.create', false, 'admins.edit', false, 'admins.disable', false,
      'leads.view', false, 'leads.manage', false
    )
    when 'read_only' then jsonb_build_object(
      'cafes.view', true, 'cafes.verify', false, 'cafes.edit', false, 'cafes.suspend', false,
      'users.view', true, 'health.view', true,
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
    'cafes.view','cafes.verify','cafes.edit','cafes.suspend',
    'users.view','health.view',
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
    'cafes.view','cafes.verify','cafes.edit','cafes.suspend',
    'users.view','health.view',
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
