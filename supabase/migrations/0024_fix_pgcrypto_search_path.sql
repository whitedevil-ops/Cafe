-- ============================================================================
-- 0024 — Fix `function digest(text, unknown) does not exist` in the customer
-- verification functions from 0023.
--
-- ROOT CAUSE: Supabase installs pgcrypto into the `extensions` schema, not
-- `public`. The `create extension if not exists pgcrypto` in schema.sql was
-- therefore a silent no-op — the extension already existed elsewhere. Every
-- function in 0023 pinned `set search_path = public`, which excludes
-- `extensions`, so digest(), crypt(), gen_salt() and gen_random_bytes() were
-- all unreachable at runtime.
--
-- WHY IT WASN'T CAUGHT EARLIER: the functions CREATE fine — search_path is
-- only resolved when the body executes. check-schema.sql reported present =
-- true for all of them. The smoke test caught it precisely because it calls
-- the functions instead of just looking them up.
--
-- SCOPE: 0023 only. No earlier migration uses pgcrypto inside a function with
-- a pinned search_path (the demo seed's crypt() calls run in a plain DO block,
-- which inherits the session search_path and so was unaffected).
--
-- THE FIX: `set search_path = public, extensions`. Still an explicit, fixed
-- search_path — which is what makes SECURITY DEFINER safe — just one that
-- actually includes where pgcrypto lives. Listing `public` first preserves
-- current resolution order, and the migration stays correct even on a setup
-- where pgcrypto happens to live in public.
-- ============================================================================

create or replace function customer_session_identity(p_session_token text)
returns table (customer_id uuid, cafe_id uuid)
language plpgsql stable security definer set search_path = public, extensions as $$
declare v_hash text;
begin
  if p_session_token is null or length(p_session_token) < 32 then return; end if;
  v_hash := encode(digest(p_session_token, 'sha256'), 'hex');

  return query
  select s.customer_id, s.cafe_id
  from customer_sessions s
  where s.token_hash = v_hash
    and s.revoked_at is null
    and s.expires_at > now();
end $$;

revoke execute on function customer_session_identity(text) from public, anon, authenticated;

create or replace function customer_issue_otp(p_table_token text, p_phone text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_cafe_id uuid;
  v_status  text;
  v_phone   text;
  v_recent  integer;
  v_code    text;
begin
  select t.cafe_id into v_cafe_id from cafe_tables t where t.token = p_table_token;
  if v_cafe_id is null then raise exception 'invalid table'; end if;

  select c.status into v_status from cafes c where c.id = v_cafe_id;
  if v_status <> 'active' then raise exception 'this café is not currently active'; end if;

  v_phone := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
  if v_phone is null or v_phone !~ '^[6-9][0-9]{9}$' then raise exception 'invalid phone number'; end if;

  select count(*) into v_recent from customer_otp_challenges o
    where o.cafe_id = v_cafe_id and o.phone = v_phone and o.created_at > now() - interval '15 minutes';
  if v_recent >= 3 then
    raise exception 'too many codes requested — please wait a few minutes before trying again';
  end if;

  update customer_otp_challenges set consumed_at = now()
    where cafe_id = v_cafe_id and phone = v_phone and consumed_at is null;

  -- Simplified from 0023: one 4-byte draw is already 32 bits of CSPRNG
  -- entropy, so the earlier shift-and-OR of four separate draws bought
  -- nothing and only obscured what the line does.
  v_code := lpad((
    (get_byte(gen_random_bytes(4), 0)::bigint * 16777216
   + get_byte(gen_random_bytes(4), 0)::bigint * 65536
   + get_byte(gen_random_bytes(4), 0)::bigint * 256
   + get_byte(gen_random_bytes(4), 0)::bigint) % 1000000)::text, 6, '0');

  insert into customer_otp_challenges (cafe_id, phone, code_hash, expires_at)
  values (v_cafe_id, v_phone, crypt(v_code, gen_salt('bf')), now() + interval '10 minutes');

  return jsonb_build_object('ok', true, 'phone', v_phone, 'code', v_code, 'expires_in_seconds', 600);
end $$;

revoke execute on function customer_issue_otp(text, text) from public, anon, authenticated;
grant execute on function customer_issue_otp(text, text) to service_role;

create or replace function customer_verify_otp(p_table_token text, p_phone text, p_code text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_cafe_id     uuid;
  v_phone       text;
  v_challenge   record;
  v_customer_id uuid;
  v_token       text;
begin
  select t.cafe_id into v_cafe_id from cafe_tables t where t.token = p_table_token;
  if v_cafe_id is null then raise exception 'invalid table'; end if;

  v_phone := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
  if v_phone is null then raise exception 'invalid phone number'; end if;

  select * into v_challenge from customer_otp_challenges o
    where o.cafe_id = v_cafe_id and o.phone = v_phone and o.consumed_at is null
    order by o.created_at desc limit 1;

  if v_challenge is null or v_challenge.expires_at < now() then
    raise exception 'this code has expired — request a new one';
  end if;

  if v_challenge.attempts >= 5 then
    update customer_otp_challenges set consumed_at = now() where id = v_challenge.id;
    raise exception 'too many incorrect attempts — request a new code';
  end if;

  if v_challenge.code_hash <> crypt(coalesce(p_code, ''), v_challenge.code_hash) then
    update customer_otp_challenges set attempts = attempts + 1 where id = v_challenge.id;
    raise exception 'that code is not correct';
  end if;

  update customer_otp_challenges set consumed_at = now() where id = v_challenge.id;

  insert into customers (cafe_id, phone, last_seen) values (v_cafe_id, v_phone, now())
  on conflict (cafe_id, phone) do update set last_seen = now()
  returning id into v_customer_id;

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into customer_sessions (cafe_id, customer_id, token_hash, expires_at)
  values (v_cafe_id, v_customer_id, encode(digest(v_token, 'sha256'), 'hex'), now() + interval '90 days');

  return jsonb_build_object('ok', true, 'session_token', v_token, 'customer_id', v_customer_id);
end $$;

grant execute on function customer_verify_otp(text, text, text) to anon, authenticated;
