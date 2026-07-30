-- ============================================================================
-- 0116 — The "Add Admin" dialog now lets the caller set permission overrides
-- at creation time, not just afterwards via "Change permissions". Previously
-- the create route always sent p_permissions:{} (hardcoded), so op_create_admin
-- never actually validated caller-supplied keys — safe by construction, since
-- nothing untrusted reached it. Now that real client input flows into that
-- parameter, op_create_admin gets the same key-allowlist loop
-- op_update_admin_permissions already has, so an unknown key is rejected at
-- creation exactly like it would be on a later edit.
--
-- op_create_admin recreated verbatim from 0079, plus the one new validation
-- loop — same care as every other high-traffic-function edit this project
-- makes.
-- ============================================================================

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
    'admins.view','admins.create','admins.edit','admins.disable'
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
