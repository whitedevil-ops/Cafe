-- ============================================================================
-- 0197 — Lock down /signup with an invite token.
--
-- /signup (email-OTP self-serve registration) has never had any gate at all
-- — no middleware entry, no layout guard, nothing (confirmed by reading
-- proxy.ts/updateSession(), app/(auth)/layout.tsx, and the page itself).
-- It's unlinked from every marketing page (those go through /get-started,
-- which only ever creates a `leads` row), but a visitor who knows or guesses
-- the URL could self-register directly, bypassing the lead-review step
-- entirely.
--
-- This does NOT touch the separate, already-working staff-onboarding paths:
--   * app/api/staff/create (owner sets a new staff member's password
--     directly) never visits /signup at all.
--   * cafe_invites/claim_my_invites (the "copy invite message" flow in
--     Settings) is dormant — no current UI creates new rows there (grepped
--     for .rpc('create_staff_invite' across app/: zero calls), and
--     production has 0 rows in cafe_invites today (checked live). It runs
--     at /onboarding, decoupled from how the auth user was created, so it
--     is unaffected by a token gate on /signup itself either way.
--
-- Token shape mirrors print_bridge_tokens (0027_kot_printing.sql): a random
-- 32-byte token, SHA-256 hashed at rest, resolved via a security definer
-- function — not the shorter human-typed OTP-code shape (this is a link,
-- not a code), and not cafe_tables.token's unhashed shape (a table QR code
-- isn't sensitive if seen; an account-creation invite should be).
--
-- resolve_signup_invite/consume_signup_invite are service_role-only (same
-- posture as issue_signup_otp/verify_signup_otp) rather than anon-grantable
-- — token validation happens server-side in the Next.js API routes via the
-- admin client, never exposed to a direct anon Postgres call.
--
-- Bound to a specific email at issue time: the token only works for the
-- exact address it was issued for, so a leaked/forwarded link can't be used
-- to register a different account than the one actually approved.
-- ============================================================================

create table if not exists signup_invites (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at    timestamptz,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists signup_invites_email_idx on signup_invites (lower(email));

alter table signup_invites enable row level security;
drop policy if exists "admin all" on signup_invites;
create policy "admin all" on signup_invites for all
  using (has_platform_permission('leads.manage'))
  with check (has_platform_permission('leads.manage'));

-- ── Issue (ops console, leads.manage) ───────────────────────────────────────
create or replace function issue_signup_invite(p_email text, p_expiry_days integer default 14)
returns text language plpgsql security definer set search_path = public as $$
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

  -- Raw token returned exactly once here — only its hash is ever persisted.
  return v_token;
end $$;
revoke execute on function issue_signup_invite(text, integer) from public, anon;
grant execute on function issue_signup_invite(text, integer) to authenticated;

-- ── Revoke (ops console, leads.manage) ──────────────────────────────────────
create or replace function revoke_signup_invite(p_invite_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_platform_permission('leads.manage') then raise exception 'not authorized'; end if;

  update signup_invites set revoked_at = now()
  where id = p_invite_id and used_at is null and revoked_at is null;

  insert into platform_audit_logs (actor_id, action, target_type, target_id)
  values (auth.uid(), 'signup_invite.revoked', 'signup_invite', p_invite_id);
end $$;
revoke execute on function revoke_signup_invite(uuid) from public, anon;
grant execute on function revoke_signup_invite(uuid) to authenticated;

-- ── List (ops console, leads.view) ──────────────────────────────────────────
create or replace function op_list_signup_invites()
returns table(
  id uuid, email text, expires_at timestamptz, used_at timestamptz,
  revoked_at timestamptz, created_at timestamptz, created_by_name text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_platform_permission('leads.view') then raise exception 'not authorized'; end if;

  return query
    select si.id, si.email, si.expires_at, si.used_at, si.revoked_at, si.created_at,
           coalesce(p.full_name, p.email, 'Unknown')
    from signup_invites si
    left join profiles p on p.id = si.created_by
    order by si.created_at desc
    limit 200;
end $$;
revoke execute on function op_list_signup_invites() from public, anon;
grant execute on function op_list_signup_invites() to authenticated;

-- ── Resolve/consume — service_role only, called from the Next.js API routes
--    via the admin client, never from anon Postgres directly. ─────────────
create or replace function resolve_signup_invite(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
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
revoke execute on function resolve_signup_invite(text) from public, anon, authenticated;
grant execute on function resolve_signup_invite(text) to service_role;

create or replace function consume_signup_invite(p_token text, p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_hash text;
  v_row  record;
begin
  v_hash := encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
  -- Row-locked so two concurrent completions of the same token can't both
  -- succeed — the second one hits "already been used" instead of racing
  -- past the used_at check.
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
revoke execute on function consume_signup_invite(text, text) from public, anon, authenticated;
grant execute on function consume_signup_invite(text, text) to service_role;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.tables where table_name = 'signup_invites') then
    raise exception 'signup_invites table missing';
  end if;
  if (select count(*) from pg_proc where proname = 'issue_signup_invite') <> 1 then
    raise exception 'issue_signup_invite: expected exactly one overload';
  end if;
  if (select count(*) from pg_proc where proname = 'revoke_signup_invite') <> 1 then
    raise exception 'revoke_signup_invite: expected exactly one overload';
  end if;
  if (select count(*) from pg_proc where proname = 'op_list_signup_invites') <> 1 then
    raise exception 'op_list_signup_invites: expected exactly one overload';
  end if;
  if (select count(*) from pg_proc where proname = 'resolve_signup_invite') <> 1 then
    raise exception 'resolve_signup_invite: expected exactly one overload';
  end if;
  if (select count(*) from pg_proc where proname = 'consume_signup_invite') <> 1 then
    raise exception 'consume_signup_invite: expected exactly one overload';
  end if;
end $$;
