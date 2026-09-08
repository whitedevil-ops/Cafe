-- ============================================================================
-- 0226 — audit-log RPC for the new "change a café owner/staff member's
-- email directly" Ops action.
--
-- The actual email change happens in the API route via Supabase Auth's
-- admin API (auth.admin.updateUserById + email_confirm: true) — it needs
-- the service-role key, which only works from a plain server-side call, not
-- a SECURITY DEFINER function. This RPC only records that it happened,
-- same division of labor as op_log_admin_password_reset /
-- op_log_password_reset for the password-reset flows.
--
-- Independently re-checks super_admin — the route already gates this, but
-- every RPC in this codebase re-verifies its own authorization rather than
-- trusting the caller already checked (see reset-password/route.ts's own
-- comment on exactly this point). No has_platform_permission() key maps to
-- "is a super_admin" (permissions are granular capability flags, not role
-- checks), so this checks platform_admins.role directly, same pattern as
-- op_create_admin's super_admin-creating-super_admin check.
-- ============================================================================

create or replace function op_log_member_email_changed(
  p_cafe_id uuid, p_target_user_id uuid, p_old_email text, p_new_email text
) returns void language plpgsql security definer set search_path = public as $$
declare v_caller_role text;
begin
  select role into v_caller_role from platform_admins where user_id = auth.uid() and status = 'active';
  if v_caller_role is distinct from 'super_admin' then raise exception 'not authorized'; end if;

  insert into platform_audit_logs (actor_id, action, target_type, target_id, previous_value, new_value)
  values (auth.uid(), 'cafe.member_email_changed', 'cafe', p_cafe_id,
          jsonb_build_object('user_id', p_target_user_id, 'email', p_old_email),
          jsonb_build_object('user_id', p_target_user_id, 'email', p_new_email));
end $$;

revoke execute on function op_log_member_email_changed(uuid, uuid, text, text) from public, anon;
grant execute on function op_log_member_email_changed(uuid, uuid, text, text) to authenticated;

-- ── self-check ─────────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_proc where proname = 'op_log_member_email_changed') <> 1 then
    raise exception 'op_log_member_email_changed: expected exactly one overload';
  end if;
  if exists (
    select 1 from information_schema.routine_privileges
    where routine_name = 'op_log_member_email_changed' and grantee in ('anon', 'PUBLIC')
  ) then
    raise exception 'op_log_member_email_changed must not be callable by anon/public';
  end if;
end $$;
