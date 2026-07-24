-- ============================================================================
-- 0059 — Plan-gated "add another café": pro → +1 (cap 2), business → +5 (cap 6).
--
-- Every owner's FIRST café is always free regardless of plan (you can't have
-- a plan without a café — that's what normal /signup + /onboarding already
-- gives everyone). This migration only gates the 2nd+ café.
--
-- max_owned_cafes lives on platform_plans, not hardcoded in application code
-- — matching this project's existing "dynamic plans" principle (0019's own
-- comment: "not hardcoded plan names scattered through the app").
--   trial    -> 1  (no add option)
--   starter  -> 1  (no add option)
--   pro      -> 2  (+1 additional)
--   business -> 6  (+5 additional)
--
-- Enforcement is in create_or_resume_onboarding_cafe() itself (0058) — not
-- just a hidden UI button. owned_cafe_capacity() exposes the same number so
-- the "+ Add café" UI and the RPC can never disagree.
-- ============================================================================

alter table platform_plans add column if not exists max_owned_cafes integer not null default 1;
update platform_plans set max_owned_cafes = 1 where key in ('trial', 'starter');
update platform_plans set max_owned_cafes = 2 where key = 'pro';
update platform_plans set max_owned_cafes = 6 where key = 'business';

-- Read-only: how many cafés this user owns vs. what their plan(s) allow.
-- Always evaluated against the caller's own auth.uid() — never a
-- client-supplied user id, so this can never be used to probe another
-- owner's café count.
create or replace function owned_cafe_capacity()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_owned integer;
  v_cap   integer;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select count(*) into v_owned from cafes where owner_id = v_uid;

  -- Highest cap across every café this user already owns (a user who owns
  -- cafés on different plans gets the most generous one they've earned —
  -- simplest rule that can never be gamed by downgrading one café to reduce
  -- another's limit, since caps only ever combine via MAX, never subtract).
  select coalesce(max(pp.max_owned_cafes), 1) into v_cap
    from cafes c join platform_plans pp on pp.key = c.plan
   where c.owner_id = v_uid;

  return jsonb_build_object('owned', v_owned, 'cap', v_cap, 'can_add', v_owned < v_cap);
end $$;

revoke execute on function owned_cafe_capacity() from public, anon;
grant execute on function owned_cafe_capacity() to authenticated;

-- ── Enforce the same cap inside café creation itself ────────────────────────
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
language plpgsql security definer set search_path = public as $$
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

  -- Resume a draft this same user already started, rather than creating a
  -- second café. One in-progress onboarding at a time per user is a
  -- deliberate, safe simplification — not a general one-café-per-owner limit
  -- (an owner can still be invited into or later create additional cafés
  -- once this one is complete).
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

  -- Plan-gated cap — ONLY applies once the user already owns at least one
  -- café. A brand-new user's first café is never blocked by this (see the
  -- header comment: everyone gets one café free via normal signup).
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
  -- Two near-simultaneous submits both took the "no draft found" branch;
  -- whichever insert wins is authoritative, the loser resumes it instead of
  -- raising a confusing "duplicate key" error to the browser.
  when unique_violation then
    select id into v_cafe_id from cafes
      where owner_id = v_uid and onboarding_step <> 'complete'
      order by created_at desc limit 1;
    if v_cafe_id is not null then
      return jsonb_build_object('cafe_id', v_cafe_id, 'resumed', true);
    end if;
    raise;
end $$;

revoke execute on function create_or_resume_onboarding_cafe(text, text, text, text, text, text, text, text, text, boolean, text, text) from public, anon;
grant execute on function create_or_resume_onboarding_cafe(text, text, text, text, text, text, text, text, text, boolean, text, text) to authenticated;
