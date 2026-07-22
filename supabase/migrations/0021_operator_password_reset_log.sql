-- ============================================================================
-- 0021 — Records a password-reset initiation. The reset itself happens via
-- Supabase Auth's own resetPasswordForEmail() from the API route (server-side,
-- using the anon key — that method needs no elevated privilege, it's the same
-- "forgot password" flow every user already has). This RPC only exists so the
-- write lands in BOTH password_reset_log and platform_audit_logs atomically —
-- the API route runs as the operator's own session, which has no direct
-- INSERT policy on platform_audit_logs (by design: only SECURITY DEFINER
-- functions may write there, so a compromised operator session still can't
-- tamper with the audit trail directly).
-- ============================================================================

create or replace function op_log_password_reset(
  p_cafe_id uuid, p_target_user_id uuid, p_target_email text, p_status text, p_error text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;

  insert into password_reset_log (cafe_id, target_user_id, target_email, initiated_by, status, error)
  values (p_cafe_id, p_target_user_id, p_target_email, auth.uid(), p_status, p_error);

  insert into platform_audit_logs (actor_id, action, target_type, target_id, new_value)
  values (auth.uid(), 'cafe.password_reset_initiated', 'cafe', p_cafe_id,
          jsonb_build_object('target_email', p_target_email, 'status', p_status));
end $$;

revoke execute on function op_log_password_reset(uuid, uuid, text, text, text) from public, anon;
grant execute on function op_log_password_reset(uuid, uuid, text, text, text) to authenticated;
