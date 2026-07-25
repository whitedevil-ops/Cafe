-- ============================================================================
-- 0065 — Fix "function gen_random_bytes(integer) does not exist" in three
-- functions that missed the fix 0024 already established for this exact bug.
--
-- ROOT CAUSE (same as 0024): Supabase installs pgcrypto into the `extensions`
-- schema, not `public`. Any SECURITY DEFINER function pinning
-- `set search_path = public` cannot see gen_random_bytes()/digest()/crypt()
-- at runtime, even though the function itself CREATEs without error.
--
-- REPORTED LIVE: adding a new table in Floors & Tables failed with exactly
-- this error — save_floor_layout's INSERT branch calls gen_random_bytes(9)
-- to mint the table's QR token. Auditing every other gen_random_bytes/
-- digest/crypt/gen_salt call in the migration history for the same gap
-- turned up two more functions with live user impact:
--   * create_or_resume_onboarding_cafe — every brand-new café signup calls
--     this to mint its slug. New café creation has been broken since 0058.
--   * set_cafe_razorpay — mints the webhook routing token on first connect.
--     Connecting Razorpay for the first time has been broken since 0046.
-- (0027's KOT token functions and 0023's OTP functions already correctly
-- have `public, extensions` — 0024 fixed 0023's; 0027 was written after and
-- got it right the first time. Those are unaffected.)
--
-- THE FIX: identical to 0024 — `set search_path = public, extensions`.
-- Signatures are UNCHANGED, so this is a pure in-place CREATE OR REPLACE;
-- nothing calling these three RPCs needs to change.
-- ============================================================================

create or replace function save_floor_layout(p_cafe_id uuid, p_areas jsonb, p_tables jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a jsonb; t jsonb; v_archiving boolean;
begin
  if not has_cafe_role(p_cafe_id, array['owner','manager']::member_role[]) then
    raise exception 'only an owner or manager can edit the floor layout';
  end if;

  for a in select * from jsonb_array_elements(coalesce(p_areas, '[]'::jsonb)) loop
    if nullif(a->>'id', '') is not null then
      update floor_areas set
        name     = coalesce(nullif(trim(a->>'name'), ''), name),
        sort     = coalesce((a->>'sort')::int, sort),
        archived = coalesce((a->>'archived')::boolean, false)
      where id = (a->>'id')::uuid and cafe_id = p_cafe_id;
    else
      insert into floor_areas (cafe_id, name, sort, archived)
      values (p_cafe_id, coalesce(nullif(trim(a->>'name'), ''), 'Area'),
              coalesce((a->>'sort')::int, 0), coalesce((a->>'archived')::boolean, false));
    end if;
  end loop;

  for t in select * from jsonb_array_elements(coalesce(p_tables, '[]'::jsonb)) loop
    if nullif(t->>'id', '') is not null then
      v_archiving := coalesce((t->>'archived')::boolean, false);

      -- Refuse to archive a table that is mid-service.
      if v_archiving and exists (
        select 1 from table_sessions s
        where s.table_id = (t->>'id')::uuid
          and s.cafe_id = p_cafe_id
          and s.status in ('active', 'bill_requested')
      ) then
        raise exception 'Table % has an active session — finish or move it before removing it',
          coalesce(nullif(trim(t->>'label'), ''), 'this one');
      end if;

      update cafe_tables set
        label    = coalesce(nullif(trim(t->>'label'), ''), label),
        capacity = nullif(t->>'capacity', '')::int,
        shape    = coalesce(nullif(t->>'shape', ''), 'square'),
        area_id  = nullif(t->>'area_id', '')::uuid,
        pos_x    = nullif(t->>'pos_x', '')::numeric,
        pos_y    = nullif(t->>'pos_y', '')::numeric,
        archived = v_archiving
      where id = (t->>'id')::uuid and cafe_id = p_cafe_id;
    else
      insert into cafe_tables (cafe_id, label, capacity, shape, area_id, pos_x, pos_y, token, status)
      values (p_cafe_id, coalesce(nullif(trim(t->>'label'), ''), 'T'),
              nullif(t->>'capacity', '')::int, coalesce(nullif(t->>'shape', ''), 'square'),
              nullif(t->>'area_id', '')::uuid, nullif(t->>'pos_x', '')::numeric, nullif(t->>'pos_y', '')::numeric,
              encode(gen_random_bytes(9), 'hex'), 'available');
    end if;
  end loop;

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (p_cafe_id, auth.uid(), 'floor.layout_saved', 'cafe_tables', null,
          jsonb_build_object('areas', jsonb_array_length(coalesce(p_areas, '[]'::jsonb)),
                             'tables', jsonb_array_length(coalesce(p_tables, '[]'::jsonb))));

  return jsonb_build_object('ok', true);
end $$;
revoke execute on function save_floor_layout(uuid, jsonb, jsonb) from public, anon;
grant execute on function save_floor_layout(uuid, jsonb, jsonb) to authenticated;

create or replace function create_or_resume_onboarding_cafe(
  p_name           text,
  p_business_type  text,
  p_phone          text,
  p_email          text default null,
  p_address        text default null,
  p_city           text default null,
  p_state          text default null,
  p_pincode        text default null,
  p_country        text default 'IN',
  p_gst_registered boolean default false,
  p_legal_name     text default null,
  p_gstin          text default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid      uuid := auth.uid();
  v_cafe_id  uuid;
  v_slug     text;
  v_name     text;
  v_owned    integer;
  v_cap      integer;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  v_name := nullif(trim(coalesce(p_name, '')), '');
  if v_name is null then
    raise exception 'café name is required';
  end if;

  select id into v_cafe_id from cafes
    where owner_id = v_uid and onboarding_step <> 'complete'
    order by created_at desc limit 1;

  if v_cafe_id is not null then
    update cafes set
      name            = v_name,
      business_type   = coalesce(nullif(trim(p_business_type), ''), business_type),
      phone           = nullif(trim(coalesce(p_phone, '')), ''),
      email           = nullif(trim(coalesce(p_email, '')), ''),
      address         = nullif(trim(coalesce(p_address, '')), ''),
      city            = nullif(trim(coalesce(p_city, '')), ''),
      state           = nullif(trim(coalesce(p_state, '')), ''),
      pincode         = nullif(trim(coalesce(p_pincode, '')), ''),
      country         = coalesce(nullif(trim(p_country), ''), 'IN'),
      gst_registered  = coalesce(p_gst_registered, false),
      legal_name      = case when p_gst_registered then nullif(trim(coalesce(p_legal_name, '')), '') else null end,
      gstin           = case when p_gst_registered then nullif(trim(coalesce(p_gstin, '')), '') else null end,
      onboarding_step = 'details'
    where id = v_cafe_id;

    return jsonb_build_object('cafe_id', v_cafe_id, 'resumed', true);
  end if;

  select count(*) into v_owned from cafes where owner_id = v_uid;
  if v_owned > 0 then
    select coalesce(max(pp.max_owned_cafes), 1) into v_cap
      from cafes c join platform_plans pp on pp.key = c.plan
     where c.owner_id = v_uid;
    if v_owned >= v_cap then
      raise exception 'plan_limit_reached: your current plan allows % café(s) — upgrade to add another', v_cap;
    end if;
  end if;

  v_slug := lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(encode(gen_random_bytes(4), 'hex'), 1, 6);

  insert into cafes (
    owner_id, slug, name, business_type, phone, email, address, city, state, pincode, country,
    gst_registered, legal_name, gstin, onboarding_step
  ) values (
    v_uid, v_slug, v_name, coalesce(nullif(trim(p_business_type), ''), 'cafe'),
    nullif(trim(coalesce(p_phone, '')), ''), nullif(trim(coalesce(p_email, '')), ''),
    nullif(trim(coalesce(p_address, '')), ''), nullif(trim(coalesce(p_city, '')), ''),
    nullif(trim(coalesce(p_state, '')), ''), nullif(trim(coalesce(p_pincode, '')), ''),
    coalesce(nullif(trim(p_country), ''), 'IN'),
    coalesce(p_gst_registered, false),
    case when p_gst_registered then nullif(trim(coalesce(p_legal_name, '')), '') else null end,
    case when p_gst_registered then nullif(trim(coalesce(p_gstin, '')), '') else null end,
    'details'
  ) returning id into v_cafe_id;

  insert into cafe_members (cafe_id, user_id, role) values (v_cafe_id, v_uid, 'owner');
  insert into cafe_settings (cafe_id) values (v_cafe_id);

  return jsonb_build_object('cafe_id', v_cafe_id, 'resumed', false);
exception
  when unique_violation then
    select id into v_cafe_id from cafes
      where owner_id = v_uid and onboarding_step <> 'complete'
      order by created_at desc limit 1;
    if v_cafe_id is not null then
      return jsonb_build_object('cafe_id', v_cafe_id, 'resumed', true);
    end if;
    raise;
end $$;

create or replace function set_cafe_razorpay(
  p_cafe_id            uuid,
  p_key_id             text,
  p_key_secret_enc     text,
  p_webhook_secret_enc text
) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_token text;
begin
  if not has_cafe_role(p_cafe_id, array['owner','manager']::member_role[]) then
    raise exception 'not authorized';
  end if;
  if p_key_id is null or trim(p_key_id) = '' then raise exception 'key id is required'; end if;

  insert into cafe_payment_secrets (cafe_id, provider, key_secret_enc, webhook_secret_enc, updated_at)
  values (p_cafe_id, 'razorpay', p_key_secret_enc, p_webhook_secret_enc, now())
  on conflict (cafe_id) do update
    set key_secret_enc = excluded.key_secret_enc,
        webhook_secret_enc = excluded.webhook_secret_enc,
        updated_at = now();

  select coalesce(razorpay_webhook_token, encode(gen_random_bytes(16), 'hex'))
    into v_token from cafes where id = p_cafe_id;

  update cafes
     set razorpay_key_id = trim(p_key_id),
         razorpay_status = 'connected',
         razorpay_webhook_token = v_token,
         online_payments_enabled = true
   where id = p_cafe_id;

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (p_cafe_id, auth.uid(), 'payments.razorpay_connected', 'cafes', p_cafe_id,
          jsonb_build_object('key_id_last4', right(trim(p_key_id), 4)));

  return v_token;
end $$;
revoke execute on function set_cafe_razorpay(uuid, text, text, text) from public, anon;
grant execute on function set_cafe_razorpay(uuid, text, text, text) to authenticated;
