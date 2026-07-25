-- ============================================================================
-- 0082 — Fix "function gen_random_bytes(integer) does not exist" in
-- customer_start_session (0081) — the same pgcrypto/search_path gap already
-- fixed twice before (0024, 0065). Supabase installs pgcrypto into the
-- `extensions` schema, not `public`; a SECURITY DEFINER function pinning
-- `set search_path = public` cannot see gen_random_bytes()/digest() at
-- runtime even though CREATE succeeds without error. Confirmed live: every
-- call to customer_start_session was failing since 0081 shipped.
--
-- Signature unchanged — pure in-place CREATE OR REPLACE, nothing calling
-- this RPC needs to change.
-- ============================================================================

create or replace function customer_start_session(p_table_token text, p_phone text, p_name text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_cafe_id     uuid;
  v_status      text;
  v_phone       text;
  v_name        text;
  v_customer_id uuid;
  v_recent      integer;
  v_token       text;
begin
  select t.cafe_id into v_cafe_id from cafe_tables t where t.token = p_table_token;
  if v_cafe_id is null then raise exception 'invalid table'; end if;

  select status into v_status from cafes where id = v_cafe_id;
  if v_status <> 'active' then raise exception 'this café is not currently active'; end if;

  v_phone := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
  if v_phone is null or v_phone !~ '^[6-9][0-9]{9}$' then raise exception 'invalid phone number'; end if;

  v_name := nullif(trim(coalesce(p_name, '')), '');
  if v_name is null then raise exception 'name is required'; end if;

  select count(*) into v_recent from customer_sessions s
    join customers c on c.id = s.customer_id
    where c.cafe_id = v_cafe_id and c.phone = v_phone and s.created_at > now() - interval '1 hour';
  if v_recent >= 5 then
    raise exception 'too many attempts for this number — please try again in a while';
  end if;

  insert into customers (cafe_id, phone, name, last_seen)
  values (v_cafe_id, v_phone, v_name, now())
  on conflict (cafe_id, phone) do update set name = v_name, last_seen = now()
  returning id into v_customer_id;

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into customer_sessions (cafe_id, customer_id, token_hash, expires_at)
  values (v_cafe_id, v_customer_id, encode(digest(v_token, 'sha256'), 'hex'), now() + interval '90 days');

  return jsonb_build_object('ok', true, 'session_token', v_token, 'customer_id', v_customer_id, 'name', v_name, 'phone', v_phone);
end $$;
