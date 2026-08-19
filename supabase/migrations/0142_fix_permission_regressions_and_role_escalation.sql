-- ============================================================================
-- 0142 — HIGH: three permission-model bugs, all found by the SECURITY
--        DEFINER classification workflow.
--
-- CONFIRMED BY A 12-AGENT AUDIT WITH INDEPENDENT ADVERSARIAL RE-VERIFICATION.
--
-- BUG 1 — role_default_permissions silently dropped two rounds of keys
-- 0102 added 'cafes.delete' (true for super_admin only) to every branch.
-- 0117 added 'leads.view'/'leads.manage' to every branch, and its own
-- redefinition of the function already dropped 'cafes.delete' by recreating
-- from the 0079 body instead of 0102's. 0134 then recreated the function
-- again — this time from something upstream of 0117 too — adding
-- 'cafes.impersonate' but dropping BOTH 'cafes.delete' and 'leads.view'/
-- 'leads.manage'. Net effect at HEAD: every admin, including super_admin,
-- silently fails has_platform_permission('cafes.delete'/'leads.view'/
-- 'leads.manage') unless they hold a per-admin override — fail-closed (denies
-- legitimate admins, including op_delete_cafe's own check), not an
-- over-grant, but it defeats the documented permission model. Fixed by
-- restoring the dropped keys with their original 0102/0117 per-role values,
-- and — since this function has now silently lost keys on two consecutive
-- redefinitions — explicitly listing 'cafes.impersonate' for every non-
-- super_admin role too (previously implicit-false-by-absence for four of the
-- five roles), matching this function's own documented convention that every
-- key should be spelled out rather than inferred from absence.
--
-- BUG 2 — op_create_admin / op_update_admin_permissions: allow-list missing
-- the two newest permissions
-- Both RPCs' v_allowed array (0117) predates 0102's 'cafes.delete' (no —
-- 0117 postdates 0102, but never added it) and 0134's 'cafes.impersonate'.
-- Net effect: no admin can ever be granted an override for either of the two
-- most sensitive permissions through the admin-management UI, even by a
-- super_admin. Fixed by adding both keys to both allow-lists.
--
-- BUG 3 — op_create_admin / op_update_admin_permissions: lateral privilege
-- escalation
-- Both RPCs check the CALLER holds 'admins.create'/'admins.edit' (correct),
-- and op_create_admin additionally blocks a non-super_admin from minting a
-- peer super_admin (correct) — but neither bounds the PERMISSIONS being
-- granted to the caller's own effective permission set. A caller who holds
-- 'admins.create'/'admins.edit' only via a per-admin override (not by role —
-- only super_admin gets either by role default) could grant a new or
-- existing admin any other allow-listed permission, including ones the
-- caller itself does not hold — e.g. a support_admin given only
-- 'admins.edit' as an override could still hand another admin
-- 'admins.disable' or 'subscriptions.manage'. Fixed by requiring the caller
-- already hold (via has_platform_permission, which checks their own
-- override-then-role-default chain) any key it is setting to true. Setting a
-- key to FALSE is never blocked — restricting someone else's access is not
-- an escalation.
--
-- BUG 4 — create_staff_invite / create_staff_member: unrestricted p_role
-- Both check the caller is owner/manager (correct) but never restrict what
-- role can be GRANTED — a manager (not an owner) could call either with
-- p_role = 'owner' and mint a new full owner of the café. create_staff_member
-- is the one actually wired into the app
-- (app/api/staff/create/route.ts:5's ROLES allowlist excludes 'owner') but
-- that is an app-layer-only guard; the RPC itself, callable directly via
-- supabase.rpc(), had no server-side check. Fixed by requiring the caller
-- themselves be an owner whenever p_role = 'owner'.
-- ============================================================================

-- ── BUG 1: restore the dropped keys, spell out cafes.impersonate for all ───
create or replace function role_default_permissions(p_role text)
returns jsonb language sql immutable as $$
  select case p_role
    when 'super_admin' then jsonb_build_object(
      'cafes.view', true, 'cafes.verify', true, 'cafes.edit', true, 'cafes.suspend', true,
      'cafes.delete', true, 'cafes.impersonate', true,
      'users.view', true, 'health.view', true,
      'plans.view', true, 'plans.change', true, 'subscriptions.view', true, 'subscriptions.manage', true,
      'audit.view', true,
      'admins.view', true, 'admins.create', true, 'admins.edit', true, 'admins.disable', true,
      'leads.view', true, 'leads.manage', true
    )
    when 'operations_admin' then jsonb_build_object(
      'cafes.view', true, 'cafes.verify', true, 'cafes.edit', true, 'cafes.suspend', false,
      'cafes.delete', false, 'cafes.impersonate', false,
      'users.view', true, 'health.view', true,
      'plans.view', false, 'plans.change', false, 'subscriptions.view', false, 'subscriptions.manage', false,
      'audit.view', false,
      'admins.view', false, 'admins.create', false, 'admins.edit', false, 'admins.disable', false,
      'leads.view', true, 'leads.manage', false
    )
    when 'support_admin' then jsonb_build_object(
      'cafes.view', true, 'cafes.verify', false, 'cafes.edit', false, 'cafes.suspend', false,
      'cafes.delete', false, 'cafes.impersonate', false,
      'users.view', true, 'health.view', true,
      'plans.view', false, 'plans.change', false, 'subscriptions.view', false, 'subscriptions.manage', false,
      'audit.view', false,
      'admins.view', false, 'admins.create', false, 'admins.edit', false, 'admins.disable', false,
      'leads.view', false, 'leads.manage', false
    )
    when 'billing_admin' then jsonb_build_object(
      'cafes.view', true, 'cafes.verify', false, 'cafes.edit', false, 'cafes.suspend', false,
      'cafes.delete', false, 'cafes.impersonate', false,
      'users.view', false, 'health.view', false,
      'plans.view', true, 'plans.change', true, 'subscriptions.view', true, 'subscriptions.manage', true,
      'audit.view', false,
      'admins.view', false, 'admins.create', false, 'admins.edit', false, 'admins.disable', false,
      'leads.view', false, 'leads.manage', false
    )
    when 'read_only' then jsonb_build_object(
      'cafes.view', true, 'cafes.verify', false, 'cafes.edit', false, 'cafes.suspend', false,
      'cafes.delete', false, 'cafes.impersonate', false,
      'users.view', true, 'health.view', true,
      'plans.view', true, 'plans.change', false, 'subscriptions.view', true, 'subscriptions.manage', false,
      'audit.view', false,
      'admins.view', false, 'admins.create', false, 'admins.edit', false, 'admins.disable', false,
      'leads.view', true, 'leads.manage', false
    )
    else '{}'::jsonb
  end;
$$;

-- ── BUG 2 + 3: complete allow-list, plus "cannot grant what you don't have" ─
create or replace function op_update_admin_permissions(p_admin_id uuid, p_permissions jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_target platform_admins%rowtype;
  v_caller_admin_id uuid;
  v_key text;
  v_allowed text[] := array[
    'cafes.view','cafes.verify','cafes.edit','cafes.suspend','cafes.delete','cafes.impersonate',
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
    -- Granting (true) is capped at the caller's own effective permission set —
    -- restricting (false) never is, since that can only narrow the target's
    -- access, never widen it beyond the caller's own.
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

-- ── BUG 4: only an owner may grant the owner role ───────────────────────────
create or replace function create_staff_invite(
  p_cafe_id uuid,
  p_email   text,
  p_role    member_role
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_email      text;
  v_max_staff  integer;
  v_seat_count integer;
  v_id         uuid;
begin
  if not has_cafe_role(p_cafe_id, array['owner','manager']::member_role[]) then
    raise exception 'only an owner or manager can invite staff';
  end if;
  if p_role = 'owner' and not has_cafe_role(p_cafe_id, array['owner']::member_role[]) then
    raise exception 'only an owner can invite another owner';
  end if;

  v_email := lower(trim(coalesce(p_email, '')));
  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'enter a valid email address';
  end if;

  select pp.max_staff into v_max_staff
    from cafes c join platform_plans pp on pp.key = c.plan
   where c.id = p_cafe_id;

  if v_max_staff is not null then
    select
      (select count(*) from cafe_members where cafe_id = p_cafe_id and status = 'active')
      + (select count(*) from cafe_invites where cafe_id = p_cafe_id)
      into v_seat_count;
    if v_seat_count >= v_max_staff then
      raise exception 'your plan allows up to % staff seats (active members + pending invites) — remove one or upgrade your plan', v_max_staff;
    end if;
  end if;

  insert into cafe_invites (cafe_id, email, role)
  values (p_cafe_id, v_email, p_role)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'email', v_email, 'role', p_role::text);
end $$;

create or replace function create_staff_member(p_cafe_id uuid, p_user_id uuid, p_role member_role)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_max_staff  integer;
  v_seat_count integer;
begin
  if not has_cafe_role(p_cafe_id, array['owner','manager']::member_role[]) then
    raise exception 'only an owner or manager can add staff';
  end if;
  if p_role = 'owner' and not has_cafe_role(p_cafe_id, array['owner']::member_role[]) then
    raise exception 'only an owner can add another owner';
  end if;

  select pp.max_staff into v_max_staff
    from cafes c join platform_plans pp on pp.key = c.plan
   where c.id = p_cafe_id;

  if v_max_staff is not null then
    select
      (select count(*) from cafe_members where cafe_id = p_cafe_id and status = 'active')
      + (select count(*) from cafe_invites where cafe_id = p_cafe_id)
      into v_seat_count;
    if v_seat_count >= v_max_staff then
      raise exception 'your plan allows up to % staff seats (active members + pending invites) — remove one or upgrade your plan', v_max_staff;
    end if;
  end if;

  insert into cafe_members (cafe_id, user_id, role, status)
  values (p_cafe_id, p_user_id, p_role, 'active')
  on conflict (cafe_id, user_id) do update set role = excluded.role, status = 'active';

  return jsonb_build_object('cafe_id', p_cafe_id, 'user_id', p_user_id, 'role', p_role::text);
end $$;

-- Grants unchanged for every function above (all already correctly scoped to
-- authenticated only) — this migration changes bodies, not privileges.

-- ── Prove the restored keys actually resolve now ────────────────────────────
do $$
begin
  if coalesce((role_default_permissions('super_admin') ->> 'cafes.delete')::boolean, false) is distinct from true then
    raise exception 'role_default_permissions(super_admin).cafes.delete did not restore to true';
  end if;
  if coalesce((role_default_permissions('super_admin') ->> 'leads.view')::boolean, false) is distinct from true then
    raise exception 'role_default_permissions(super_admin).leads.view did not restore to true';
  end if;
  if coalesce((role_default_permissions('super_admin') ->> 'leads.manage')::boolean, false) is distinct from true then
    raise exception 'role_default_permissions(super_admin).leads.manage did not restore to true';
  end if;
  if coalesce((role_default_permissions('operations_admin') ->> 'cafes.impersonate')::boolean, false) is distinct from false then
    raise exception 'role_default_permissions(operations_admin).cafes.impersonate should be false';
  end if;
end $$;
