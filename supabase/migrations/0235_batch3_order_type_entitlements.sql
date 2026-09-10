-- ============================================================================
-- 0235 — Batch 3 (SQL half) of the ungated-features entitlement project:
-- dine-in and takeaway ordering.
--
-- enforce_enabled_order_type() fires BEFORE INSERT on orders for BOTH the
-- anonymous QR-ordering path (place_order) and the staff POS path
-- (staff_place_order) — there is no session on the former, so this uses
-- cafe_feature_for_guest(), never cafe_has_feature()/hasFeature(). Using the
-- member-only function here would not merely fail open on an error, it
-- would fail PERMANENTLY CLOSED for every café's QR orders the instant this
-- shipped, the exact bug class 0092/0112/0178 already hit once each.
--
-- AND'd with the existing cafes.dine_in/cafes.takeaway columns, not
-- replacing them — 'dine_in_ordering'/'takeaway_ordering' were seeded true
-- on every plan by 0233, so <column> AND <key> is identical to <column>
-- alone for every café until an Ops admin deliberately overrides one off.
-- ============================================================================

create or replace function enforce_enabled_order_type() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_dine boolean;
  v_take boolean;
begin
  select dine_in, takeaway into v_dine, v_take from cafes where id = new.cafe_id;

  if new.type = 'dine_in' and (
    not coalesce(v_dine, true) or not cafe_feature_for_guest(new.cafe_id, 'dine_in_ordering')
  ) then
    raise exception 'dine-in ordering is turned off for this café';
  end if;
  if new.type = 'takeaway' and (
    not coalesce(v_take, true) or not cafe_feature_for_guest(new.cafe_id, 'takeaway_ordering')
  ) then
    raise exception 'takeaway ordering is turned off for this café';
  end if;

  return new;
end $$;

-- Trigger itself is unchanged (same function, same timing) — no drop/recreate needed.

-- ── self-check ───────────────────────────────────────────────────────────
do $$
declare v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'enforce_enabled_order_type';
  if v_src is null then raise exception 'enforce_enabled_order_type does not exist'; end if;
  if v_src !~ 'cafe_feature_for_guest\(new.cafe_id, ''dine_in_ordering''\)' then
    raise exception 'enforce_enabled_order_type is missing the dine_in_ordering entitlement check';
  end if;
  if v_src !~ 'cafe_feature_for_guest\(new.cafe_id, ''takeaway_ordering''\)' then
    raise exception 'enforce_enabled_order_type is missing the takeaway_ordering entitlement check';
  end if;
  -- The one thing that must NEVER be true here — using the member-only
  -- function on this anonymous-reachable trigger would break every QR order.
  if v_src ~ 'cafe_has_feature\(new.cafe_id' then
    raise exception 'enforce_enabled_order_type must not use cafe_has_feature (member-only) — it runs on anonymous QR orders too';
  end if;
end $$;
