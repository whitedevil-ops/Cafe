-- ============================================================================
-- Full-audit finding, CRITICAL, live-reproduced: record_payment() has zero
-- concurrency protection. Two concurrent calls for the same order (exactly
-- what a rapid double-tap on floor-client.tsx's "Confirm ₹<amount>" button
-- produces) both read order_outstanding() BEFORE either has committed,
-- both see the full outstanding balance, both pass the `p_amount >
-- v_outstanding` guard, and both insert. Live-reproduced: a real ₹79 order
-- ended up with 2 payments rows totaling ₹158 (sum(payments.amount)=158 >
-- orders.total=79), orders.payment_status='paid', no error surfaced to
-- either caller. floor-client.tsx's only guard is a React "busy" state
-- disabling the button — exactly the frontend-only protection this audit
-- was asked not to trust.
--
-- This codebase already has the correct doctrine for this exact bug class,
-- applied once before for wallet_confirm_topup (0139_fix_wallet_topup_race.sql,
-- confirmed by a 12-agent audit with adversarial re-verification): a lock
-- reordering alone is "trust the logic", a hard constraint is "prove it" —
-- two independent layers.
--
--  1. LOGIC: serialize concurrent calls for the SAME order with
--     pg_advisory_xact_lock BEFORE computing order_outstanding(), not after.
--     Under READ COMMITTED, whichever call acquires the lock second is
--     guaranteed to see the first call's already-committed payment once it
--     gets in — the same guarantee 0139 restored for wallet top-ups.
--
--  2. CONSTRAINT: a hard trigger-level backstop on `payments` itself,
--     rejecting any insert that would push an order's total collected past
--     its total — not just inside record_payment, but for EVERY insert path
--     into this table, including the Razorpay webhook's own direct insert
--     (app/api/payments/razorpay/webhook/[token]/route.ts:128-140). That
--     path is already separately idempotent via a real unique constraint on
--     (provider, provider_payment_id) — this trigger does not change its
--     behavior under normal operation, only backstops it (and every other
--     path) against ever over-collecting on one order.
--
-- record_session_payment (0047:298-335, the split-bill path) is unaffected
-- in its own right — it computes its own take-amount capped at
-- order_outstanding() per order, but ultimately calls record_payment() for
-- every actual insert, so it inherits this fix for free without needing its
-- own change.
-- ============================================================================

create or replace function record_payment(
  p_order_id  uuid,
  p_amount    integer,
  p_method    text,
  p_reference text default null,
  p_source    text default 'manual',
  p_attempt_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id     uuid;
  v_session_id  uuid;
  v_outstanding integer;
  v_payment_id  uuid;
begin
  select cafe_id, session_id into v_cafe_id, v_session_id from orders where id = p_order_id;
  if v_cafe_id is null then raise exception 'order not found'; end if;
  if not is_cafe_member(v_cafe_id) then raise exception 'not authorized'; end if;
  if p_method not in ('cash','card','upi','counter','split') then raise exception 'invalid payment method'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be greater than zero'; end if;

  -- Serialize concurrent record_payment calls for the SAME order so the
  -- outstanding-balance check below is never evaluated against a stale,
  -- pre-commit snapshot from another in-flight call — the exact race that
  -- produced a live ₹158-against-a-₹79-order double payment.
  perform pg_advisory_xact_lock(hashtext('order-payment:' || p_order_id::text));

  v_outstanding := order_outstanding(p_order_id);
  if v_outstanding <= 0 then raise exception 'this order is already fully paid'; end if;
  if p_amount > v_outstanding then
    raise exception 'amount ₹% exceeds the outstanding ₹%', p_amount, v_outstanding;
  end if;

  insert into payments (cafe_id, order_id, session_id, method, amount, reference, confirmed_by, source, attempt_id)
  values (v_cafe_id, p_order_id, v_session_id, p_method::payment_method, p_amount,
          nullif(trim(coalesce(p_reference, '')), ''), auth.uid(),
          coalesce(nullif(trim(p_source), ''), 'manual'), p_attempt_id)
  returning id into v_payment_id;

  if p_attempt_id is not null then
    update payment_attempts
       set status = 'confirmed', confirmed_at = now(), confirmed_by = auth.uid(), payment_id = v_payment_id
     where id = p_attempt_id and cafe_id = v_cafe_id and status <> 'confirmed';
  end if;

  -- Reflect the real payment method on the order (unless it was a generic
  -- 'counter' placeholder being recorded — keep the concrete method).
  update orders set payment_method = p_method::payment_method where id = p_order_id;

  perform recompute_order_payment_status(p_order_id);

  return jsonb_build_object(
    'payment_id', v_payment_id,
    'outstanding', order_outstanding(p_order_id),
    'payment_status', (select payment_status from orders where id = p_order_id));
end $$;
revoke execute on function record_payment(uuid, integer, text, text, text, uuid) from public, anon;
grant execute on function record_payment(uuid, integer, text, text, text, uuid) to authenticated;

-- ── Hard backstop: no order can ever collect more than its own total,
-- through any insert path into `payments`, ever. ──────────────────────────
create or replace function trg_payments_no_overcollect() returns trigger
language plpgsql as $$
declare
  v_total integer;
  v_collected integer;
begin
  select total into v_total from orders where id = new.order_id;
  select coalesce(sum(amount), 0) into v_collected from payments where order_id = new.order_id;
  if v_collected > v_total then
    raise exception 'payments for order % would total ₹% against a ₹% order — rejected', new.order_id, v_collected, v_total;
  end if;
  return new;
end $$;

drop trigger if exists payments_no_overcollect on payments;
create trigger payments_no_overcollect
  after insert on payments
  for each row execute function trg_payments_no_overcollect();

-- ── self-check ───────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_proc where proname = 'record_payment') <> 1 then
    raise exception 'record_payment: expected exactly one overload';
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'payments_no_overcollect' and not tgisinternal
  ) then
    raise exception 'payments_no_overcollect trigger was not created';
  end if;
end $$;
