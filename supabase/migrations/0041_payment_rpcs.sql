-- ============================================================================
-- 0041 — Payment RPCs. Every rupee here is SERVER-computed; no amount from a
-- customer or staff browser is ever trusted as the payable figure.
-- ============================================================================

-- ── Outstanding on a single order = its total minus confirmed payments ─────
create or replace function order_outstanding(p_order_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  select greatest(0, o.total - coalesce((select sum(p.amount) from payments p where p.order_id = o.id), 0))
  from orders o where o.id = p_order_id;
$$;
revoke execute on function order_outstanding(uuid) from public, anon;
grant execute on function order_outstanding(uuid) to authenticated;

-- ── Recompute an order's coarse payment_status from confirmed money ────────
-- Moves only between unpaid / partial / paid. Never touches a 'refunded'
-- order (refunds own that state) and never a cancelled one.
create or replace function recompute_order_payment_status(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_o record; v_paid integer;
begin
  select status, payment_status, total into v_o from orders where id = p_order_id;
  if not found then return; end if;
  if v_o.status = 'cancelled' or v_o.payment_status = 'refunded' then return; end if;

  select coalesce(sum(amount), 0) into v_paid from payments where order_id = p_order_id;

  update orders set payment_status =
    case when v_o.total > 0 and v_paid >= v_o.total then 'paid'
         when v_paid > 0 then 'partial'
         else 'unpaid' end
  where id = p_order_id;
end $$;
revoke execute on function recompute_order_payment_status(uuid) from public, anon;
grant execute on function recompute_order_payment_status(uuid) to authenticated;

-- ── record_payment: the ONE trusted way to book money against an order ─────
-- Validates against the server's outstanding figure and refuses overpayment,
-- inserts the immutable payments row (which the 0016 audit trigger logs),
-- links any attempt, and recomputes the order's status.
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

  perform recompute_order_payment_status(p_order_id);

  return jsonb_build_object(
    'payment_id', v_payment_id,
    'outstanding', order_outstanding(p_order_id),
    'payment_status', (select payment_status from orders where id = p_order_id));
end $$;
revoke execute on function record_payment(uuid, integer, text, text, text, uuid) from public, anon;
grant execute on function record_payment(uuid, integer, text, text, text, uuid) to authenticated;

-- ── qr_start_upi_payment: anon customer begins a UPI payment ───────────────
-- Returns a UPI intent URI built entirely on the server with the server's
-- outstanding figure. The customer's browser never supplies the amount.
create or replace function qr_start_upi_payment(p_receipt_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_o          record;
  v_cafe       record;
  v_amount     integer;
  v_attempt_id uuid;
  v_uri        text;
  v_tn         text;
begin
  select o.id, o.cafe_id, o.session_id, o.total, o.short_code
    into v_o from orders o where o.receipt_token = p_receipt_token;
  if v_o.id is null then raise exception 'order not found'; end if;

  select upi_enabled, upi_id, coalesce(nullif(trim(upi_name), ''), name) as payee,
         qr_payment_mode, payment_qr_url, name
    into v_cafe from cafes where id = v_o.cafe_id;

  if not coalesce(v_cafe.upi_enabled, false) or v_cafe.upi_id is null or trim(v_cafe.upi_id) = '' then
    raise exception 'online payment is not available for this café';
  end if;
  if v_cafe.qr_payment_mode = 'pay_later' then
    raise exception 'this café accepts payment at the counter only';
  end if;

  v_amount := order_outstanding(v_o.id);
  if v_amount <= 0 then raise exception 'this order is already paid'; end if;

  insert into payment_attempts (cafe_id, order_id, session_id, amount, method, status)
  values (v_o.cafe_id, v_o.id, v_o.session_id, v_amount, 'upi', 'initiated')
  returning id into v_attempt_id;

  -- Standards UPI deep link. Amount and payee come only from the server.
  v_tn := 'Order ' || v_o.short_code;
  v_uri := 'upi://pay?pa=' || v_cafe.upi_id
        || '&pn=' || replace(v_cafe.payee, ' ', '%20')
        || '&am=' || v_amount::text
        || '&cu=INR'
        || '&tn=' || replace(v_tn, ' ', '%20');

  return jsonb_build_object(
    'attempt_id', v_attempt_id,
    'amount', v_amount,
    'upi_id', v_cafe.upi_id,
    'payee_name', v_cafe.payee,
    'upi_uri', v_uri,
    'qr_url', v_cafe.payment_qr_url);
end $$;
grant execute on function qr_start_upi_payment(uuid) to anon, authenticated;

-- ── qr_claim_payment: customer says "I have paid" — records the CLAIM only ──
-- This NEVER marks anything paid. It flags the attempt for staff to confirm
-- and drops a notification onto the café's board.
create or replace function qr_claim_payment(p_attempt_id uuid, p_reference text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_a record; v_label text;
begin
  select a.id, a.cafe_id, a.order_id, a.session_id, a.amount, a.status, o.short_code, o.table_id
    into v_a
    from payment_attempts a join orders o on o.id = a.order_id
   where a.id = p_attempt_id;
  if v_a.id is null then raise exception 'payment attempt not found'; end if;
  if v_a.status = 'confirmed' then return jsonb_build_object('ok', true, 'already_confirmed', true); end if;

  update payment_attempts
     set status = 'claimed', claimed_at = now(),
         reference = nullif(trim(coalesce(p_reference, '')), '')
   where id = p_attempt_id and status <> 'confirmed';

  select label into v_label from cafe_tables where id = v_a.table_id;

  insert into notifications (cafe_id, type, message, table_id, session_id)
  values (v_a.cafe_id, 'payment_claimed',
          coalesce('Table ' || v_label || ' — ', '') || 'customer paid ₹' || v_a.amount
            || ' by UPI for order #' || v_a.short_code || ' — confirm receipt',
          v_a.table_id, v_a.session_id);

  return jsonb_build_object('ok', true);
end $$;
grant execute on function qr_claim_payment(uuid, text) to anon, authenticated;

-- ── Pending UPI claims a café still needs to confirm ───────────────────────
create or replace function pending_payment_claims(p_cafe_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_cafe_member(p_cafe_id) then raise exception 'not authorized'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'attempt_id', a.id, 'order_id', a.order_id, 'short_code', o.short_code,
      'table_label', t.label, 'amount', a.amount, 'reference', a.reference,
      'claimed_at', a.claimed_at) order by a.claimed_at desc), '[]'::jsonb)
    from payment_attempts a
    join orders o on o.id = a.order_id
    left join cafe_tables t on t.id = o.table_id
    where a.cafe_id = p_cafe_id and a.status = 'claimed'
  );
end $$;
revoke execute on function pending_payment_claims(uuid) from public, anon;
grant execute on function pending_payment_claims(uuid) to authenticated;
