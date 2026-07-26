-- ============================================================================
-- 0098 — Auto refund-to-wallet.
--
-- Previously a refund's method defaulted from orders.payment_method, which —
-- as 0097 already had to fix once for Bills — is set once at order creation
-- and is only sometimes kept in sync afterward (record_payment updates it,
-- but the Razorpay webhook and wallet_charge_order never did). So an order
-- actually paid from the customer's wallet still defaulted to refunding by
-- "cash" or whatever stale method the order started with.
--
-- Fix: derive the default refund method from the ACTUAL payments ledger
-- (same technique as 0097's list_bills fix) rather than orders.payment_method
-- — when exactly one distinct method was used, that's the default; ambiguous
-- (split) or absent stays on the old fallback chain, since there's no single
-- right answer to auto-pick there.
--
-- And when the resolved method — auto-picked or staff-chosen — is 'wallet',
-- this now actually credits the customer's wallet (wallet_transactions),
-- not just records "method: wallet" on the refunds row with no real money
-- movement behind it. Requires the order have a linked customer and the
-- café have the wallet feature on; a manager/owner/cashier can also choose
-- "wallet" explicitly for any order with a linked customer, as a store-
-- credit alternative to a cash/card reversal.
-- ============================================================================

alter table wallet_transactions drop constraint if exists wallet_transactions_kind_check;
alter table wallet_transactions add constraint wallet_transactions_kind_check
  check (kind in ('topup', 'spend', 'adjustment', 'refund'));

create or replace function refund_order(
  p_order_id uuid,
  p_reason   text,
  p_method   text default null,
  p_amount   integer default null,
  p_items    jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order        record;
  v_role         member_role;
  v_limit        integer;
  v_already      integer;
  v_remaining    integer;
  v_amount       integer := 0;
  v_kind         text;
  v_method       payment_method;
  v_actual       text;
  v_refund_id    uuid;
  v_item         jsonb;
  v_oi           record;
  v_qty          integer;
  v_prior_qty    integer;
  v_line_value   integer;
  v_share        integer;
  v_priced       jsonb := '[]'::jsonb;
begin
  select o.id, o.cafe_id, o.customer_id, o.total, o.subtotal, o.payment_status, o.payment_method, o.short_code
    into v_order
    from orders o where o.id = p_order_id;
  if v_order.id is null then raise exception 'order not found'; end if;

  select role into v_role from cafe_members
   where cafe_id = v_order.cafe_id and user_id = auth.uid() and status = 'active';
  if v_role is null then raise exception 'not authorized for this café'; end if;
  if v_role not in ('owner', 'manager', 'cashier') then
    raise exception 'your role cannot issue refunds';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'a refund reason is required';
  end if;

  -- Refunding money that was never collected would silently invent a liability.
  if v_order.payment_status <> 'paid' then
    raise exception 'this order is not marked paid — there is nothing to refund';
  end if;

  v_already := order_refunded_total(p_order_id);
  v_remaining := v_order.total - v_already;
  if v_remaining <= 0 then raise exception 'this order has already been fully refunded'; end if;

  select case count(distinct method) when 1 then min(method::text) else null end into v_actual
    from payments where order_id = p_order_id;
  v_method := coalesce(nullif(p_method, '')::payment_method, nullif(v_actual, '')::payment_method, v_order.payment_method, 'cash');

  -- ── Item-level ───────────────────────────────────────────────────────────
  -- Validate and price every line BEFORE writing anything, so the authorisation
  -- check below sees the real total and no partially-built refund ever exists.
  if p_items is not null and jsonb_array_length(p_items) > 0 then
    v_kind := 'item';

    for v_item in select * from jsonb_array_elements(p_items) loop
      select oi.id, oi.price, oi.qty, oi.name into v_oi
        from order_items oi
       where oi.id = (v_item->>'order_item_id')::uuid and oi.order_id = p_order_id;
      if v_oi.id is null then raise exception 'item does not belong to this order'; end if;

      v_qty := greatest(1, coalesce((v_item->>'qty')::int, 1));

      -- Can't refund the same unit twice.
      select coalesce(sum(ri.qty), 0) into v_prior_qty
        from refund_items ri
        join refunds r on r.id = ri.refund_id
       where ri.order_item_id = v_oi.id and r.status = 'completed';
      if v_prior_qty + v_qty > v_oi.qty then
        raise exception 'cannot refund % × % — only % of that line remain unrefunded',
          v_qty, v_oi.name, v_oi.qty - v_prior_qty;
      end if;

      -- Refund the line's PROPORTIONAL share of what was actually charged, so
      -- an order-level discount or tax is not over-refunded. Refunding the raw
      -- line price on a discounted bill would hand back more than was taken.
      v_line_value := v_oi.price * v_qty;
      v_share := case when v_order.subtotal > 0
                      then round(v_order.total::numeric * v_line_value / v_order.subtotal)::integer
                      else v_line_value end;

      v_priced := v_priced || jsonb_build_object(
        'order_item_id', v_oi.id, 'qty', v_qty, 'amount', v_share);
      v_amount := v_amount + v_share;
    end loop;

    -- Rounding each line can drift a rupee past the remaining balance.
    v_amount := least(v_amount, v_remaining);
    if v_amount <= 0 then raise exception 'refund amount resolved to zero'; end if;

  -- ── Full / partial cash-value ────────────────────────────────────────────
  else
    v_amount := coalesce(p_amount, v_remaining);
    if v_amount <= 0 then raise exception 'refund amount must be greater than zero'; end if;
    if v_amount > v_remaining then
      raise exception 'cannot refund ₹% — only ₹% of this order remains unrefunded', v_amount, v_remaining;
    end if;
    v_kind := case when v_amount = v_order.total and v_already = 0 then 'full' else 'partial' end;
  end if;

  -- Authorisation is checked against the RESOLVED amount, not the requested
  -- one, so an item selection cannot be used to slip past a cashier's limit.
  select refund_approval_limit into v_limit from cafes where id = v_order.cafe_id;
  if v_role = 'cashier' and v_amount > coalesce(v_limit, 500) then
    raise exception 'refunds above ₹% need a manager or owner', coalesce(v_limit, 500);
  end if;

  if v_method = 'wallet' then
    if v_order.customer_id is null then
      raise exception 'this order has no linked customer — cannot refund to a wallet';
    end if;
    if not cafe_has_feature(v_order.cafe_id, 'wallet') then
      raise exception 'the wallet feature is not enabled for this café';
    end if;
  end if;

  insert into refunds (cafe_id, order_id, amount, method, kind, reason, refunded_by, approved_by)
  values (v_order.cafe_id, p_order_id, v_amount, v_method, v_kind, trim(p_reason), auth.uid(),
          case when v_role in ('owner','manager') then auth.uid() end)
  returning id into v_refund_id;

  -- Item lines, priced above, written now that the refund row exists.
  if v_kind = 'item' then
    insert into refund_items (refund_id, order_item_id, qty, amount)
    select v_refund_id, (x->>'order_item_id')::uuid, (x->>'qty')::int, (x->>'amount')::int
      from jsonb_array_elements(v_priced) x;
  end if;

  -- The refund row above is the record of HOW the money left the café's
  -- books (unchanged for cash/card/upi — those stay a manual, off-system
  -- handback); a wallet refund additionally moves the money back into the
  -- customer's own balance, which no other method needs.
  if v_method = 'wallet' then
    perform pg_advisory_xact_lock(hashtext('wallet:' || v_order.cafe_id::text || ':' || v_order.customer_id::text));
    insert into wallet_transactions (cafe_id, customer_id, kind, amount, order_id, reason, created_by)
    values (v_order.cafe_id, v_order.customer_id, 'refund', v_amount, p_order_id,
            'Refund for order #' || v_order.short_code, auth.uid());
  end if;

  -- Only a fully refunded order flips status. 'partial' in this enum means
  -- partially PAID, so using it here would misreport a partly-refunded bill.
  if v_already + v_amount >= v_order.total then
    update orders set payment_status = 'refunded' where id = p_order_id;
  end if;

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (v_order.cafe_id, auth.uid(), 'order.refunded', 'orders', p_order_id,
          jsonb_build_object(
            'refund_id', v_refund_id, 'amount', v_amount, 'kind', v_kind,
            'method', v_method, 'reason', trim(p_reason), 'role', v_role,
            'order_total', v_order.total, 'previously_refunded', v_already));

  return jsonb_build_object(
    'refund_id', v_refund_id, 'amount', v_amount, 'kind', v_kind,
    'method', v_method, 'remaining', v_order.total - (v_already + v_amount));
end $$;

revoke execute on function refund_order(uuid, text, text, integer, jsonb) from public, anon;
grant execute on function refund_order(uuid, text, text, integer, jsonb) to authenticated;

-- ── order_settlement also exposes the real settlement method, so the client
-- can pre-select the right refund method instead of trusting the stale
-- orders.payment_method. ────────────────────────────────────────────────────
create or replace function order_settlement(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cafe uuid; v_paid integer; v_refunded integer; v_total integer; v_method text;
begin
  select cafe_id, total into v_cafe, v_total from orders where id = p_order_id;
  if v_cafe is null then raise exception 'order not found'; end if;
  if not is_cafe_member(v_cafe) then raise exception 'not authorized'; end if;

  select coalesce(sum(amount), 0)::integer into v_paid from payments where order_id = p_order_id;
  v_refunded := order_refunded_total(p_order_id);

  select case count(distinct method) when 1 then min(method::text) else 'split' end into v_method
    from payments where order_id = p_order_id;

  return jsonb_build_object(
    'order_total', v_total,
    'paid', v_paid,
    'refunded', v_refunded,
    'net_collected', v_paid - v_refunded,
    'refundable_remaining', greatest(v_total - v_refunded, 0),
    'actual_method', v_method);
end $$;

revoke execute on function order_settlement(uuid) from public, anon;
grant execute on function order_settlement(uuid) to authenticated;
