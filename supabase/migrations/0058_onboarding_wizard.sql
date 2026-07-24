-- ============================================================================
-- 0058 — Multi-step onboarding: server-persisted progress + a duplicate-café
-- safe creation path.
--
-- THE GAP: the current /onboarding page does one atomic step (name + city +
-- table count) then the café is considered "done" forever — there is no
-- concept of a partially-completed, resumable signup, and a network retry on
-- that single insert could create a second café for the same owner (the
-- exact "duplicate order" class of bug this project already fixed for orders
-- in migration 0056 — the same idempotency principle applies here).
--
-- FIX:
--   1. cafes.onboarding_step tracks progress ('details' -> 'operations' ->
--      'setup' -> 'complete'). Defaults to 'complete' so every EXISTING café
--      (Brewora, tt, ...) is unaffected — this column only matters for cafés
--      created through the new wizard.
--   2. cafes.onboarding_meta holds the soft, non-authoritative business-setup
--      answers (approx tables/staff/orders-per-day, menu-import choice) —
--      informational only, never used for access control or billing.
--   3. create_or_resume_onboarding_cafe(...) — the ONLY entry point for
--      creating the café + owner membership + settings row during onboarding.
--      It looks for an existing DRAFT café owned by this user first (any
--      onboarding_step <> 'complete') and updates it instead of inserting a
--      second one — a retried submit becomes a safe no-op, never a duplicate
--      tenant. Steps 3/4 (operations, setup) are plain authenticated UPDATEs
--      from the client, which are already idempotent by nature (an UPDATE
--      re-applying the same values is a no-op) and already permitted by the
--      existing "owner update" RLS policy — no new RPC needed for those.
-- ============================================================================

alter table cafes add column if not exists onboarding_step text not null default 'complete'
  check (onboarding_step in ('details', 'operations', 'setup', 'complete'));
alter table cafes add column if not exists onboarding_meta jsonb;

-- At most one in-progress draft per owner — closes the race where two
-- near-simultaneous submits (e.g. a double-click) both pass the "does a
-- draft exist" check before either INSERT commits. The exception handler
-- below turns the loser into a safe resume instead of a duplicate café.
create unique index if not exists cafes_one_draft_per_owner
  on cafes (owner_id) where onboarding_step <> 'complete';

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
