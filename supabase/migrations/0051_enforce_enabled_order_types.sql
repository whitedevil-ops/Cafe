-- ============================================================================
-- 0051 — Enforce the café's enabled order types in the DATABASE.
--
-- BUG: cafes.dine_in / cafes.takeaway let an owner turn an order type off, but
-- the order engines only checked that p_order_type was a VALID enum value, not
-- that the café actually offers it. A crafted request —
--     staff_place_order(..., p_order_type => 'takeaway')  while takeaway=false
-- — was accepted. This is configuration that was only ever respected (partly)
-- in React.
--
-- FIX: a single BEFORE INSERT trigger on `orders`. Both canonical engines
-- (place_order for QR, staff_place_order for POS/waiter) insert into `orders`,
-- so enforcing it here covers every path — current and future — without
-- rewriting either function. Fail-closed: the whole order transaction rolls
-- back if the type is disabled.
--
-- 'delivery' is left unrestricted (no toggle exists for it yet); only the two
-- toggled types are enforced.
-- ============================================================================

create or replace function enforce_enabled_order_type() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_dine boolean;
  v_take boolean;
begin
  select dine_in, takeaway into v_dine, v_take from cafes where id = new.cafe_id;

  if new.type = 'dine_in' and not coalesce(v_dine, true) then
    raise exception 'dine-in ordering is turned off for this café';
  end if;
  if new.type = 'takeaway' and not coalesce(v_take, true) then
    raise exception 'takeaway ordering is turned off for this café';
  end if;

  return new;
end $$;

drop trigger if exists trg_enforce_enabled_order_type on orders;
create trigger trg_enforce_enabled_order_type
  before insert on orders
  for each row execute function enforce_enabled_order_type();
