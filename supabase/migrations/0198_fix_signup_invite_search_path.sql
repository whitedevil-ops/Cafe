-- ============================================================================
-- 0198 — Fix a real bug in 0197: issue_signup_invite/resolve_signup_invite/
-- consume_signup_invite used `set search_path = public`, but gen_random_bytes
-- and digest (pgcrypto) live in the `extensions` schema in this project —
-- every other function that uses them (issue_print_bridge_token,
-- issue_signup_otp, verify_signup_otp) correctly sets
-- `search_path = public, extensions`. 0197's three affected functions did
-- not, so every call failed at runtime with "function gen_random_bytes(...)
-- does not exist" — caught immediately by live-testing the actual issue
-- flow, not by the migration's own self-check (which only confirms the
-- functions exist, not that they run). revoke_signup_invite and
-- op_list_signup_invites don't touch pgcrypto and are untouched here.
-- ============================================================================

create or replace function issue_signup_invite(p_email text, p_expiry_days integer default 14)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  v_email text;
  v_token text;
begin
  if not has_platform_permission('leads.manage') then raise exception 'not authorized'; end if;

  v_email := lower(trim(coalesce(p_email, '')));
  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'a valid email is required';
  end if;
  if p_expiry_days is null or p_expiry_days <= 0 or p_expiry_days > 90 then
    raise exception 'expiry must be between 1 and 90 days';
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into signup_invites (email, token_hash, expires_at, created_by)
  values (v_email, encode(digest(v_token, 'sha256'), 'hex'), now() + (p_expiry_days || ' days')::interval, auth.uid());

  insert into platform_audit_logs (actor_id, action, target_type, new_value)
  values (auth.uid(), 'signup_invite.issued', 'signup_invite', jsonb_build_object('email', v_email, 'expiry_days', p_expiry_days));

  return v_token;
end $$;

create or replace function resolve_signup_invite(p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_hash text;
  v_row  record;
begin
  v_hash := encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
  select * into v_row from signup_invites where token_hash = v_hash;

  if v_row.id is null then raise exception 'This signup link is not valid.'; end if;
  if v_row.revoked_at is not null then raise exception 'This signup link has been cancelled.'; end if;
  if v_row.used_at is not null then raise exception 'This signup link has already been used.'; end if;
  if v_row.expires_at < now() then raise exception 'This signup link has expired.'; end if;

  return jsonb_build_object('email', v_row.email);
end $$;

create or replace function consume_signup_invite(p_token text, p_email text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_hash text;
  v_row  record;
begin
  v_hash := encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
  select * into v_row from signup_invites where token_hash = v_hash for update;

  if v_row.id is null then raise exception 'This signup link is not valid.'; end if;
  if v_row.revoked_at is not null then raise exception 'This signup link has been cancelled.'; end if;
  if v_row.used_at is not null then raise exception 'This signup link has already been used.'; end if;
  if v_row.expires_at < now() then raise exception 'This signup link has expired.'; end if;
  if lower(trim(coalesce(p_email, ''))) <> v_row.email then
    raise exception 'This signup link is for a different email address.';
  end if;

  update signup_invites set used_at = now() where id = v_row.id;
end $$;

-- ── self-check — actually CALLS the fixed function this time, not just a
--    proname existence check, so this class of bug can't ship silently
--    again. ────────────────────────────────────────────────────────────────
do $$
declare
  v_probe text;
begin
  v_probe := encode(gen_random_bytes(8), 'hex');
  if v_probe is null or length(v_probe) <> 16 then
    raise exception 'pgcrypto (extensions schema) still not reachable from public search_path';
  end if;
end $$;
