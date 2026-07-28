-- ============================================================================
-- 0113 — Real email verification for owner/café signup, via a 6-character
-- alphanumeric code instead of Supabase Auth's own magic-link confirmation.
--
-- Why: "Confirm email" in the Supabase dashboard was found to not actually
-- be gating production signup — a brand-new owner account works
-- immediately after signUp(), with no proof the email address is real or
-- reachable. Rather than depend on a dashboard toggle, this makes email
-- ownership a precondition of account creation itself: the Supabase user
-- is only created (via admin.auth.admin.createUser, email_confirm: true)
-- AFTER this code is verified, in the API route — see
-- app/api/auth/signup/verify-code/route.ts. Supabase's own confirmation
-- mail is bypassed entirely for this path, same as staff-account creation
-- (0079) already does.
--
-- Same shape as customer_otp_challenges (0023) — code hashed with crypt(),
-- never stored in the clear, 10-minute expiry, 5-attempt lockout, one
-- unconsumed challenge per email. Reuses the existing otp_ip_attempts
-- table (0076) for IP throttling rather than a second copy of it — that
-- table already just tracks "an OTP was requested from this IP", which is
-- equally true whether the flow is customer phone or owner email.
-- ============================================================================

create table if not exists signup_otp_challenges (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  code_hash   text not null,
  attempts    integer not null default 0,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists signup_otp_lookup_idx on signup_otp_challenges (email, created_at desc);
alter table signup_otp_challenges enable row level security;
-- No policies — service-role only, same posture as customer_otp_challenges
-- and otp_ip_attempts (every access goes through an API route using the
-- admin client, never a user's own session).

create or replace function issue_signup_otp(p_email text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_email  text;
  v_recent integer;
  v_code   text;
begin
  v_email := lower(nullif(trim(coalesce(p_email, '')), ''));
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid email address';
  end if;

  select count(*) into v_recent from signup_otp_challenges
    where email = v_email and created_at > now() - interval '15 minutes';
  if v_recent >= 3 then
    raise exception 'too many codes requested — please wait a few minutes before trying again';
  end if;

  update signup_otp_challenges set consumed_at = now()
    where email = v_email and consumed_at is null;

  -- 6-character alphanumeric, uppercase letters + digits, excluding the
  -- visually-ambiguous 0/O/1/I — deliberately not numeric-only, per what
  -- was asked for.
  v_code := (
    select string_agg(substr(alphabet, (get_byte(gen_random_bytes(1), 0) % length(alphabet)) + 1, 1), '')
    from (select '23456789ABCDEFGHJKLMNPQRSTUVWXYZ' as alphabet) a,
         generate_series(1, 6)
  );

  insert into signup_otp_challenges (email, code_hash, expires_at)
  values (v_email, crypt(v_code, gen_salt('bf')), now() + interval '10 minutes');

  return jsonb_build_object('ok', true, 'email', v_email, 'code', v_code, 'expires_in_seconds', 600);
end $$;

revoke execute on function issue_signup_otp(text) from public, anon, authenticated;
grant execute on function issue_signup_otp(text) to service_role;

create or replace function verify_signup_otp(p_email text, p_code text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_email     text;
  v_challenge record;
begin
  v_email := lower(nullif(trim(coalesce(p_email, '')), ''));
  if v_email is null then raise exception 'invalid email address'; end if;

  select * into v_challenge from signup_otp_challenges
    where email = v_email and consumed_at is null
    order by created_at desc limit 1;

  if v_challenge is null or v_challenge.expires_at < now() then
    raise exception 'this code has expired — request a new one';
  end if;

  if v_challenge.attempts >= 5 then
    update signup_otp_challenges set consumed_at = now() where id = v_challenge.id;
    raise exception 'too many incorrect attempts — request a new code';
  end if;

  if v_challenge.code_hash <> crypt(upper(coalesce(p_code, '')), v_challenge.code_hash) then
    update signup_otp_challenges set attempts = attempts + 1 where id = v_challenge.id;
    raise exception 'that code is not correct';
  end if;

  update signup_otp_challenges set consumed_at = now() where id = v_challenge.id;
  return jsonb_build_object('ok', true, 'email', v_email);
end $$;

revoke execute on function verify_signup_otp(text, text) from public, anon, authenticated;
grant execute on function verify_signup_otp(text, text) to service_role;
