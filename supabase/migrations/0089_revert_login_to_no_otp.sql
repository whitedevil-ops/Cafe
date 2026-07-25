-- ============================================================================
-- 0089 — Revert customer login to no-OTP, immediately. 0088 made OTP the
-- only way to start a session, but SMS was never actually configured in
-- production (SMS_PROVIDER unset) — that shipped a live outage: every
-- customer at every café was locked out of QR ordering the moment 0088
-- deployed, since customer_start_session's grant was revoked and the OTP
-- path 503s with no provider behind it.
--
-- Restores customer_start_session (0081/0082/0087) as a live entry point,
-- but its body now ALSO does the same device-registration/revocation
-- bookkeeping customer_verify_otp (0088) does — just without requiring a
-- code first. Without this, sessions it minted would have device_row_id
-- null, and customer_session_identity's device-active JOIN (0088) would
-- reject them outright, silently breaking My Orders/reorder for everyone
-- even though ordering itself would still work.
--
-- customer_verify_otp, customer_devices, customer_issue_otp, and
-- app/api/customer/request-otp all stay exactly as built — nothing here
-- is thrown away. Once SMS/DLT is actually set up, the client can go back
-- to calling customer_verify_otp instead of customer_start_session with a
-- one-line change; the device-trust model underneath doesn't need to
-- change again either way.
-- ============================================================================

drop function if exists customer_start_session(text, text, text, text);
create function customer_start_session(p_table_token text, p_phone text, p_name text, p_device_id text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_cafe_id       uuid;
  v_status        text;
  v_phone         text;
  v_name          text;
  v_customer_id   uuid;
  v_recent        integer;
  v_token         text;
  v_device_hash   text;
  v_device_row_id uuid;
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

  -- CRM identity — unchanged, still just a phone-keyed upsert.
  insert into customers (cafe_id, phone, name, last_seen)
  values (v_cafe_id, v_phone, v_name, now())
  on conflict (cafe_id, phone) do update set name = v_name, last_seen = now()
  returning id into v_customer_id;

  -- Same device-trust bookkeeping customer_verify_otp uses (one active
  -- device per customer per café), minus the OTP gate — a device switch
  -- still revokes the previous one, it just isn't proven by a code yet.
  v_device_hash := encode(
    digest(coalesce(nullif(trim(p_device_id), ''), encode(gen_random_bytes(16), 'hex')), 'sha256'),
    'hex'
  );

  select id into v_device_row_id from customer_devices
    where cafe_id = v_cafe_id and customer_id = v_customer_id
      and device_id_hash = v_device_hash and status = 'active';

  if v_device_row_id is null then
    update customer_devices set status = 'revoked', revoked_at = now()
      where cafe_id = v_cafe_id and customer_id = v_customer_id and status = 'active';
    insert into customer_devices (cafe_id, customer_id, device_id_hash, status, verified_at, last_seen_at)
      values (v_cafe_id, v_customer_id, v_device_hash, 'active', now(), now())
      returning id into v_device_row_id;
  else
    update customer_devices set last_seen_at = now() where id = v_device_row_id;
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into customer_sessions (cafe_id, customer_id, token_hash, expires_at, device_id, device_row_id)
  values (v_cafe_id, v_customer_id, encode(digest(v_token, 'sha256'), 'hex'), now() + interval '90 days',
          p_device_id, v_device_row_id);

  return jsonb_build_object('ok', true, 'session_token', v_token, 'customer_id', v_customer_id, 'name', v_name, 'phone', v_phone);
end $$;

revoke execute on function customer_start_session(text, text, text, text) from public, anon;
grant execute on function customer_start_session(text, text, text, text) to anon, authenticated;
