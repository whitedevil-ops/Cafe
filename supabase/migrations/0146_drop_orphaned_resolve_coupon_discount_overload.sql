-- ============================================================================
-- 0146 — CRITICAL, urgent follow-up to 0138: an ORPHANED overload of
--        resolve_coupon_discount survived 0138's fix and is still live,
--        still granted to `authenticated`, and still has the exact same
--        missing-authorization bug 0138 was meant to close.
--
-- FOUND BY LIVE VERIFICATION after 0137-0145 were applied: the regression
-- test written specifically to prove 0138's fix returned HTTP 300 (Multiple
-- Choices) instead of the expected 4xx rejection — PostgREST's signal that
-- more than one function named resolve_coupon_discount exists and the
-- request doesn't uniquely resolve to one of them.
--
-- ROOT CAUSE: 0061 defined resolve_coupon_discount(uuid, text, integer,
-- uuid) — 4 arguments. 0078 added category-scoping and redefined it as
-- resolve_coupon_discount(uuid, text, integer, uuid, uuid[]) — 5 arguments —
-- via `create or replace function`, which does NOT replace a function of a
-- DIFFERENT arity; it creates a second, separate overload. 0078 never
-- dropped the original 4-arg version, and neither did 0143 (which only
-- re-bodied the 5-arg signature to add entitlement checking). The 4-arg
-- orphan has been live, unaffected by both 0138's revoke and 0143's
-- entitlement check, this entire time — meaning the cross-tenant coupon
-- disclosure 0138 was written to close was never actually fully closed.
--
-- Grepped every real caller in the codebase (validate_coupon,
-- validate_coupon_public, place_order, staff_place_order) — all have called
-- the 5-arg signature since 0078; nothing has called the 4-arg one in years.
-- Safe to drop outright rather than merely revoke.
--
-- LESSON FOR THE REST OF THIS SESSION'S LOCKDOWN MIGRATIONS: every other
-- function touched in 0137/0138/0140/0141 was independently re-checked here
-- for the same class of orphaned-overload gap (grepped every historical
-- `create or replace function <name>(` across every migration file, looking
-- for a DIFFERENT argument list, not just a different body). Only
-- resolve_coupon_discount has one; apply_order_taxes, order_outstanding,
-- order_refunded_total, bill_status, build_kot_payload,
-- recompute_order_payment_status, and menu_item_effective_cost each have
-- exactly one live signature (menu_item_effective_cost's 1-arg original was
-- already correctly dropped by 0106 before its 2-arg redefinition).
--
-- REVISION: the first version of this migration (attempted, rolled back —
-- Supabase's SQL Editor runs a pasted batch as one transaction, so a failed
-- check undoes everything in it, including the DROP) verified its result by
-- string-matching pg_get_function_identity_arguments(), which raised a
-- false-positive "the real 5-arg function is missing" — the DROP itself was
-- fine; the fragile string comparison was the bug. This version verifies by
-- COUNTING overloads instead, which cannot be thrown off by a formatting
-- mismatch: after the drop there must be exactly one function named
-- resolve_coupon_discount left, no more, no fewer.
-- ============================================================================

drop function if exists resolve_coupon_discount(uuid, text, integer, uuid);

do $$
declare v_count integer;
begin
  select count(*) into v_count
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'resolve_coupon_discount';

  if v_count = 0 then
    raise exception 'resolve_coupon_discount is completely gone -- this migration would have broken coupons entirely';
  end if;
  if v_count > 1 then
    raise exception 'expected exactly one resolve_coupon_discount after the drop, found % -- the orphaned overload is still present', v_count;
  end if;
end $$;
