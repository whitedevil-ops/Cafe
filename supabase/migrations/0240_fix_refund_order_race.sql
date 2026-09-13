-- ============================================================================
-- 0240 — HIGH: refund_order has the exact over-refund race record_payment was
-- live-caught for (0180), and was never patched. Confirmed by a production
-- maturity audit (2026-09-13) with independent adversarial re-verification.
--
-- refund_order() computes v_already := order_refunded_total(p_order_id) and
-- v_remaining := v_order.total - v_already with NO lock beforehand, then
-- later inserts into `refunds`. Two concurrent refund_order calls for the
-- same order (a double-tap on the Refund button, or two staff members
-- refunding the same complaint at once) both read the same v_already under
-- READ COMMITTED, both pass the `p_amount > v_remaining` check, and both
-- insert — refunding more than the order ever collected. No error is
-- surfaced to either caller; the only trace is refunds rows summing past
-- orders.total, which nothing currently flags.
--
-- This codebase already has the correct two-layer doctrine for this exact
-- bug class (0180 for record_payment, 0139 for wallet_confirm_topup) — it
-- was just never carried over to refunds. Applying it now:
--
--  1. LOGIC: serialize concurrent refund_order calls for the SAME order with
--     pg_advisory_xact_lock, taken before v_already is computed (not after),
--     via a live regex-patch — refund_order is a ~250-line function that has
--     already been restated via literal CREATE OR REPLACE several times
--     (0028/0066/0098/0145/0194) and is currently also carrying 0234's own
--     live-patched entitlement gate; a full rewrite from this migration's
--     own source risks silently reverting that gate, exactly the "0214
--     reverted 0203's fix" failure mode 0227 had to clean up. Patching the
--     live definition in place, the same way 0234 itself did for this same
--     function, avoids that risk entirely.
--
--  2. CONSTRAINT: a hard trigger-level backstop on `refunds` itself — no
--     order's completed refunds can ever sum past its own total, through any
--     insert path, ever — mirroring trg_payments_no_overcollect exactly.
-- ============================================================================

do $$
declare
  v_src     text;
  v_new     text;
  v_pattern text := 'v_already\s*:=\s*order_refunded_total\(p_order_id\);\s*' ||
                    'v_remaining\s*:=\s*v_order\.total\s*-\s*v_already;';
  v_hits    int;
begin
  select count(*) into v_hits
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'refund_order';
  if v_hits <> 1 then
    raise exception 'expected exactly one refund_order, found % — refusing to patch an ambiguous overload', v_hits;
  end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'refund_order';
  if v_src is null then
    raise exception 'refund_order does not exist';
  end if;

  select count(*) into v_hits from regexp_matches(v_src, v_pattern, 'gi');
  if v_hits <> 1 then
    raise exception 'expected exactly one refunded-total-check anchor in refund_order, found % — refusing to guess', v_hits;
  end if;

  v_new := regexp_replace(
    v_src, v_pattern,
    E'-- Serialize concurrent refund_order calls for the SAME order so the\n' ||
    E'  -- remaining-to-refund check below is never evaluated against a stale,\n' ||
    E'  -- pre-commit snapshot from another in-flight call.\n' ||
    E'  perform pg_advisory_xact_lock(hashtext(''order-refund:'' || p_order_id::text));\n\n' ||
    E'  v_already := order_refunded_total(p_order_id);\n' ||
    E'  v_remaining := v_order.total - v_already;',
    'gi'
  );
  execute v_new;
  raise notice 'refund_order patched: concurrent refunds for the same order now serialized';
end $$;

-- ── Hard backstop: no order's completed refunds can ever sum past its own
-- total, through any insert path into `refunds`, ever. ──────────────────────
create or replace function trg_refunds_no_overrefund() returns trigger
language plpgsql as $$
declare
  v_total     integer;
  v_refunded  integer;
begin
  if new.status <> 'completed' then return new; end if;
  select total into v_total from orders where id = new.order_id;
  select coalesce(sum(amount), 0) into v_refunded from refunds where order_id = new.order_id and status = 'completed';
  if v_refunded > v_total then
    raise exception 'refunds for order % would total ₹% against a ₹% order — rejected', new.order_id, v_refunded, v_total;
  end if;
  return new;
end $$;

drop trigger if exists refunds_no_overrefund on refunds;
create trigger refunds_no_overrefund
  after insert on refunds
  for each row execute function trg_refunds_no_overrefund();

-- ── self-check ───────────────────────────────────────────────────────────
do $$
declare v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'refund_order';
  if v_src !~ 'pg_advisory_xact_lock\(hashtext\(''order-refund:''' then
    raise exception 'refund_order was not patched with the advisory lock';
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'refunds_no_overrefund' and not tgisinternal
  ) then
    raise exception 'refunds_no_overrefund trigger was not created';
  end if;
end $$;
