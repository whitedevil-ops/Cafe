-- ============================================================================
-- 0044 — record_payment also stamps the order's payment_method.
--
-- QR "pay now via UPI" orders are placed as 'counter' (place_order only
-- accepts counter/cash/card, and the order is unpaid at that point). When a
-- staff member confirms the actual payment, the bill should read how it was
-- really paid — UPI, cash, card — not the placeholder. This restores the
-- behaviour the old direct-insert settle path had, now inside the one
-- validated, audited payment function.
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
