-- ============================================================================
-- 0081 — Replace OTP verification with a direct phone + name gate for QR
-- customer sessions.
--
-- SECURITY NOTE (explicit trade-off, chosen deliberately): 0023 required a
-- verified OTP before minting a customer_sessions row specifically so that
-- typing a phone number proved nothing on its own. This function removes
-- that proof — phone + name is taken at face value, exactly like place_order
-- already does for anonymous ordering. The practical consequence: anyone who
-- knows (or guesses) a customer's phone number can open this café's QR menu,
-- enter it, and get a session that shows that customer's name and order
-- history here. There is no way to "device-scope" this without some form of
-- verification — the session token itself is never derivable from the phone
-- number and is only ever handed to whichever browser called this function,
-- but a deliberate, targeted lookup by someone who already knows the number
-- will succeed. This is a real reduction in the guarantee 0023 documented,
-- accepted here for a small-café context in exchange for zero SMS friction
-- and zero SMS cost. customer_issue_otp/customer_verify_otp are left in
-- place (unused, harmless) rather than dropped, in case OTP is wanted again
-- later; nothing in the client calls them after this migration.
--
-- Everything downstream — customer_sessions, customer_session_identity(),
-- customer_order_history(), customer_reorder_payload() — is untouched: this
-- only replaces how a session gets minted, using the exact same table/hash
-- scheme, so no other RPC needs to change.
-- ============================================================================

create or replace function customer_start_session(p_table_token text, p_phone text, p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
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

  -- Courtesy throttle only — there is no verification step here at all, so
  -- this cannot prevent a targeted lookup of a known number. It only slows
  -- down rapid automated enumeration through this one endpoint.
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

revoke execute on function customer_start_session(text, text, text) from public;
grant execute on function customer_start_session(text, text, text) to anon, authenticated;
