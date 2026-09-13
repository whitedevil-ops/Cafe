-- ============================================================================
-- 0242 — HIGH: record_payment has no check for a cancelled order. Found by
-- a final production-readiness pass, confirmed by two independent
-- adversarial re-checks.
--
-- order_outstanding() (0041) is `total - sum(payments)`, with no awareness
-- of orders.status at all — so record_payment (0180) would accept a payment
-- against a cancelled order at ANY time after cancellation, not just in a
-- narrow race window. cancel_order (0234) only refuses when payment_status
-- is already 'paid'/'partial', so an unpaid order cancels freely (e.g. the
-- kitchen ran out of the item) while a floor tablet's already-open payment
-- dialog for that same order is still live.
--
-- The result if this happens: the payment inserts successfully, but
-- recompute_order_payment_status (0048) deliberately no-ops on a cancelled
-- order (`if v_o.status = 'cancelled' ... then return;`), so payment_status
-- never becomes 'paid'. That payment is now invisible to every report
-- (sales/profitability/items filter `status <> 'cancelled'`), invisible to
-- session close-out (same filter), and cannot be refunded through the app
-- (refund_order requires `payment_status = 'paid'`) — real collected money
-- becomes a permanent orphan outside every reconciliation path the product
-- offers, findable only by a raw query against `payments` with no status
-- filter.
--
-- Fix: reject the payment outright if the order is cancelled, at the very
-- first check — before the advisory lock, matching where every other
-- early-exit validation in this function already sits. record_session_payment
-- (0234) calls record_payment() for every actual write and needs no change
-- of its own — it inherits this fix the same way it already inherited 0180's
-- lock and overcollect trigger.
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
  v_status      text;
  v_outstanding integer;
  v_payment_id  uuid;
begin
  select cafe_id, session_id, status into v_cafe_id, v_session_id, v_status from orders where id = p_order_id;
  if v_cafe_id is null then raise exception 'order not found'; end if;
  if v_status = 'cancelled' then
    raise exception 'this order was cancelled — payment cannot be recorded against it';
  end if;
  if not is_cafe_member(v_cafe_id) then raise exception 'not authorized'; end if;
  if p_method not in ('cash','card','upi','counter','split') then raise exception 'invalid payment method'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be greater than zero'; end if;

  -- Serialize concurrent record_payment calls for the SAME order so the
  -- outstanding-balance check below is never evaluated against a stale,
  -- pre-commit snapshot from another in-flight call — the exact race that
  -- produced a live ₹158-against-a-₹79-order double payment (0180).
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

-- ── self-check ───────────────────────────────────────────────────────────
do $$
declare v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_payment';
  if v_src !~ 'cancelled.*payment cannot be recorded' then
    raise exception 'record_payment was not patched with the cancelled-order guard';
  end if;
  if (select count(*) from pg_proc where proname = 'record_payment') <> 1 then
    raise exception 'record_payment: expected exactly one overload';
  end if;
end $$;
