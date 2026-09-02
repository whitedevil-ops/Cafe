-- ============================================================================
-- 0210 — A spin prize can only be spent against a real bill at its own café.
--
-- Found by the Spin & Win audit. redeem_spin_prize's p_order_id defaults to
-- null and was never validated — not for existence, not against p_cafe_id, not
-- against anything. The function is granted straight to `authenticated`, so
-- any member of a café could open the browser console and run
--
--   supabase.rpc('redeem_spin_prize', { p_cafe_id: <their café>, p_code: 'WXXXXX' })
--
-- which permanently marks a guest's prize claimed with redeemed_order_id null.
-- Two things follow from that. The guest's prize is gone with nothing given in
-- return; and there is no record of who did it or why, because the only audit
-- row for a spin claim is written by the CALLER — staff_place_order writes
-- 'spin.prize_claimed' (0154:551), not this function. A direct call leaves
-- redeemed_at set and no trail at all.
--
-- Passing another café's order id was accepted too: the FK is to orders(id)
-- with no cafe_id predicate, so a cross-tenant order id could be stamped into
-- spin_results.redeemed_order_id.
--
-- WHY REQUIRING THE ORDER IS SAFE: every caller already passes one. All four
-- historical bodies of staff_place_order call it as
-- `redeem_spin_prize(p_cafe_id, p_spin_code, v_order_id)` (0126:271, 0143:768,
-- 0149:265, 0154:528 — the live one), always inside the same transaction and
-- always after the order row exists. Nothing in the app calls it directly; the
-- till's SpinClaim box previews with find_spin_prize and never redeems. So the
-- null default was an unused convenience that only opened a hole.
--
-- Everything else about the function is deliberately untouched: the advisory
-- lock, the FOR UPDATE, the four guards, and 0205's deliberate ABSENCE of an
-- entitlement check (a prize a guest legitimately won stays honourable
-- whatever the plan has done since — 0205 installs a self-check asserting
-- that absence, and it still passes below).
-- ============================================================================

create or replace function redeem_spin_prize(p_cafe_id uuid, p_code text, p_order_id uuid default null)
returns spin_results
language plpgsql security definer set search_path = public as $$
declare v_r spin_results%rowtype;
begin
  if not exists (select 1 from cafe_members where cafe_id = p_cafe_id and user_id = auth.uid()) then
    raise exception 'not authorized for this café';
  end if;

  -- A prize is a discount ON something. Redeeming it without naming the bill
  -- it paid for is not a use case, it is a way to destroy a guest's prize with
  -- no record — see this migration's header.
  if p_order_id is null then
    raise exception 'a spin prize can only be claimed against a bill';
  end if;
  if not exists (select 1 from orders where id = p_order_id and cafe_id = p_cafe_id) then
    raise exception 'that bill does not belong to this café';
  end if;

  perform pg_advisory_xact_lock(hashtext('spinclaim:' || p_cafe_id::text || ':' || upper(trim(p_code))));

  select * into v_r from spin_results
   where cafe_id = p_cafe_id and upper(code) = upper(trim(p_code)) for update;
  if not found then raise exception 'no prize with that code'; end if;
  if v_r.redeemed_at is not null then raise exception 'that prize has already been claimed'; end if;
  if v_r.expires_at is not null and v_r.expires_at < now() then raise exception 'that prize has expired'; end if;
  if v_r.kind = 'none' then raise exception 'that spin did not win anything'; end if;

  update spin_results
     set redeemed_at = now(), redeemed_order_id = p_order_id
   where id = v_r.id
  returning * into v_r;

  return v_r;
end $$;

-- Restated rather than assumed, same reasoning as 0205: this is exactly the
-- edit where a silently-widened grant would be easiest to miss.
revoke execute on function redeem_spin_prize(uuid, text, uuid) from public, anon;
grant execute on function redeem_spin_prize(uuid, text, uuid) to authenticated;

-- ── self-check ─────────────────────────────────────────────────────────────
do $$
declare v_src text;
begin
  select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'redeem_spin_prize';
  if v_src is null then raise exception 'redeem_spin_prize is missing'; end if;

  if position('a spin prize can only be claimed against a bill' in v_src) = 0 then
    raise exception 'redeem_spin_prize still accepts a null order';
  end if;
  if position('that bill does not belong to this café' in v_src) = 0 then
    raise exception 'redeem_spin_prize still accepts a cross-tenant order id';
  end if;

  -- 0205's whole point: NO entitlement check here, so an issued prize stays
  -- honourable after a downgrade. This rewrite must not have reintroduced one.
  if position('cafe_has_feature' in v_src) > 0 or position('cafe_feature_for_guest' in v_src) > 0 then
    raise exception 'redeem_spin_prize regained an entitlement check — 0205 removed it deliberately';
  end if;

  -- The concurrency guards 0147/0205 rely on.
  if position('pg_advisory_xact_lock' in v_src) = 0 or position('for update' in v_src) = 0 then
    raise exception 'redeem_spin_prize lost its locking';
  end if;

  -- And staff_place_order must still be the thing calling it.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'staff_place_order'
       and p.prosrc like '%redeem_spin_prize(p_cafe_id, p_spin_code, v_order_id)%'
  ) then
    raise exception 'staff_place_order no longer calls redeem_spin_prize with its order id';
  end if;
end $$;
