-- ============================================================================
-- 0147 — URGENT: fix a regression I introduced in 0143. When redeem_spin_prize
--        was re-bodied to add the loyalty entitlement check, its UPDATE
--        picked up a `redeemed_by = auth.uid()` assignment that does not
--        correspond to any real column on spin_results — that column was
--        never part of the table (0125's original definition has id,
--        cafe_id, segment_id, order_id, customer_id, label, kind,
--        menu_item_id, variant_id, value, code, expires_at, redeemed_at,
--        redeemed_order_id, created_at — no redeemed_by, ever).
--
-- FOUND BY LIVE VERIFICATION, running the pre-existing spin-prize test suite
-- after applying 0137-0146: "column \"redeemed_by\" of relation
-- \"spin_results\" does not exist". This means EVERY call to
-- redeem_spin_prize has been failing outright since 0143 was applied — a
-- real regression, not a pre-existing gap. Apologies for the error; fixing
-- it now with the same urgency as the other issues found during this
-- verification pass.
--
-- Fix: drop the erroneous assignment. The entitlement check added in 0143
-- (cafe_has_feature(p_cafe_id, 'loyalty')) is the only intentional change
-- from 0125's version and is preserved exactly.
-- ============================================================================

create or replace function redeem_spin_prize(p_cafe_id uuid, p_code text, p_order_id uuid default null)
returns spin_results
language plpgsql security definer set search_path = public as $$
declare v_r spin_results%rowtype;
begin
  if not exists (select 1 from cafe_members where cafe_id = p_cafe_id and user_id = auth.uid()) then
    raise exception 'not authorized for this café';
  end if;
  if not cafe_has_feature(p_cafe_id, 'loyalty') then
    raise exception 'the spin wheel is not available on this café''s plan';
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
-- Grants unchanged (authenticated only).

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'spin_results' and column_name = 'redeemed_by'
  ) then
    raise exception 'spin_results.redeemed_by unexpectedly exists -- re-check whether the column reference this migration removed was actually valid after all';
  end if;
end $$;
