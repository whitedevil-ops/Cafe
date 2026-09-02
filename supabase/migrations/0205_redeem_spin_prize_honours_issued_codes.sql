-- ============================================================================
-- 0205 — redeem_spin_prize stops checking an entitlement at all. A prize code
-- a guest legitimately won is honoured for as long as it is valid, whatever
-- the café's plan has done since.
--
-- 0204 gave Spin & Win its own 'spin' key and deliberately left this one
-- function behind on 'loyalty', reasoning that a café mid-downgrade must
-- still honour codes it had already handed out. The instinct was right and
-- the implementation was wrong: 'loyalty' and 'spin' are now unrelated
-- products, so a café that buys Spin and never buys Loyalty — the exact
-- customer 0204 created the key in order to be able to sell to — can issue
-- prize codes all day and redeem none of them. That check was not
-- grandfathering anybody. It was a stale key doing damage.
--
-- So: which key? Neither. And the reason is structural, not a kindness.
--
-- THERE IS NOTHING LEFT TO GATE. A spin_results row can only come into
-- existence through spin_the_wheel. 0125 granted select and nothing else on
-- the table — "every write goes through an RPC below, so no insert/update/
-- delete policy is granted to anyone" — and that has not changed since, so
-- there is no path, staff or guest or hand-rolled supabase.rpc(), that mints
-- a code without first passing the issuance gate 0204 corrected. Every code
-- that exists was drawn while the café held 'spin'. A check at redemption
-- re-asks a question already answered upstream, and its only remaining
-- effect is to void promises after the fact.
--
-- WHY NOT SIMPLY MOVE IT TO 'spin'. That would have been coherent, and it
-- would have been the first version of this function able to strand a code
-- in practice. 'loyalty' and 'spin' moved as one until 0204; 'spin' is now
-- independently switchable per plan AND per café through
-- cafe_feature_overrides. An operator flipping it off to end a trial or park
-- a churned café would silently void every outstanding prize in one click,
-- with no warning anywhere that they had just done it. Consistency would
-- have bought us a sharper foot-gun.
--
-- IT REFUSES THE SALE, NOT JUST THE PRIZE. This function is called from
-- inside the order transaction (staff_place_order, 0126; create_pos_order,
-- 0149/0154), so the exception aborts the entire order rather than dropping
-- the discount from it. A café that lapsed on Friday and is still open on
-- Saturday would find its till rejecting any bill a guest presents a code
-- against — not "prize declined", but no order at all. Of the available ways
-- to chase an unpaid invoice, jamming the café's cash register while a
-- customer stands at the counter is the worst one.
--
-- THE EXPOSURE IS BOUNDED AND DRAINS ITSELF. Issuance stops the instant the
-- plan lapses, so the outstanding set is fixed and finite from that moment —
-- a downgraded café cannot grow it. Most codes carry expires_at and age out
-- on their own; where the owner set no expiry (expiry_days is nullable at
-- both the wheel and the segment level, and null means "never lapses") the
-- set is still closed, only longer-lived. A finite pile of prizes the café
-- itself promised, honoured until it is empty, is the right liability to
-- carry — and it is the café's liability either way. Refusing only moves the
-- cost onto the guest, who has no idea the café stopped paying us.
--
-- DELIBERATELY UNCHANGED: the membership check on line one. That is
-- authorization, not entitlement — only this café's own staff may claim this
-- café's codes, on any plan, and that stays. Issuance stays gated on 'spin'
-- exactly as 0204 left it; nothing here touches spin_the_wheel,
-- get_spin_wheel or save_spin_wheel.
-- ============================================================================

-- Current definition taken verbatim from 0147 (the redeemed_by column
-- regression fix, still the live body). The only change is the removal of
-- the three-line entitlement block; the advisory lock, the row lock, the
-- already-claimed/expired/'none' guards and the update all stand as they are.
-- Signature is unchanged, so CREATE OR REPLACE is enough — no drop needed.
create or replace function redeem_spin_prize(p_cafe_id uuid, p_code text, p_order_id uuid default null)
returns spin_results
language plpgsql security definer set search_path = public as $$
declare v_r spin_results%rowtype;
begin
  if not exists (select 1 from cafe_members where cafe_id = p_cafe_id and user_id = auth.uid()) then
    raise exception 'not authorized for this café';
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

-- Restated rather than assumed: dropping a check is exactly the edit where a
-- silently-widened grant would be easiest to miss. Staff only, as since 0125.
revoke execute on function redeem_spin_prize(uuid, text, uuid) from public, anon;
grant execute on function redeem_spin_prize(uuid, text, uuid) to authenticated;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
declare
  v_count integer;
  v_src   text;
begin
  -- Exactly one, or an orphaned overload is being shipped and the old
  -- loyalty-gated body stays reachable — the same class of bug 0201's and
  -- 0204's self-checks guard against.
  select count(*) into v_count from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'redeem_spin_prize';
  if v_count <> 1 then
    raise exception 'expected exactly one redeem_spin_prize, found %', v_count;
  end if;

  -- The point of this migration is an ABSENCE, and an absence is precisely
  -- what the next "copy the current body, change one line" edit can quietly
  -- put back. Assert it, so that edit fails loudly instead.
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'redeem_spin_prize';
  if v_src like '%cafe_has_feature%' or v_src like '%cafe_feature_for_guest%' then
    raise exception 'redeem_spin_prize still carries an entitlement check -- a prize code already won must redeem on any plan';
  end if;
end $$;
