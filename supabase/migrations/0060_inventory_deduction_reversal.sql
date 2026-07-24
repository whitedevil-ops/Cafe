-- ============================================================================
-- 0060 — Reverse automatic stock deduction when a cancelled order never left
-- the kitchen.
--
-- THE GAP (found auditing the order→recipe→inventory chain, per the product
-- upgrade spec's explicit ask to verify it rather than assume it works):
-- 0036's trigger deducts stock the instant an order_items row is INSERTED —
-- i.e. at placement time, not at any "prepared/served" checkpoint. Neither
-- cancel_order (0017) nor refund_order (0028) ever touch inventory at all.
--
-- cancel_order already refuses any order with payment_status in
-- ('paid','partial') — so by the time it can run, no money has changed
-- hands, and for the very case this migration targets (placed, then
-- cancelled) nothing has actually been cooked either. The stock that was
-- deducted at insert time was premature and must come back, or a café with
-- auto_deduct_stock on watches its stock permanently vanish on every
-- cancelled order with no way to notice short of a manual reconciliation.
--
-- This deliberately does NOT touch refund_order. A refund is a financial
-- event, not a physical one — by the time an order is refundable it was
-- marked paid, meaning (in every real scenario this schema models) the food
-- was already made and served. Auto-restocking on refund would fabricate
-- inventory that never physically came back to the kitchen. Cancellation
-- and refund stay asymmetric on purpose — this is the exact distinction the
-- spec calls out: "financial refund != physical inventory event."
-- ============================================================================

-- Mirrors deduct_stock_for_order_item's own shape exactly (same café gate,
-- same "never let bookkeeping break the real action" exception swallow) so
-- forward and reverse stay obviously symmetric to read side by side.
create or replace function reverse_stock_for_cancelled_order(p_order_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id uuid;
  v_enabled boolean;
  v_short   text;
  v_r       record;
begin
  begin
    select cafe_id, short_code into v_cafe_id, v_short from orders where id = p_order_id;
    if v_cafe_id is null then return; end if;

    select auto_deduct_stock into v_enabled from cafes where id = v_cafe_id;
    if not coalesce(v_enabled, false) then return; end if;

    for v_r in
      select ri.inventory_item_id, sum(ri.qty * oi.qty) as total_qty
        from order_items oi
        join recipe_items ri on ri.menu_item_id = oi.menu_item_id and ri.cafe_id = v_cafe_id
       where oi.order_id = p_order_id
       group by ri.inventory_item_id
    loop
      update inventory_items
        set current_stock = current_stock + v_r.total_qty
        where id = v_r.inventory_item_id and cafe_id = v_cafe_id;

      insert into inventory_transactions (cafe_id, item_id, delta, reason)
      values (v_cafe_id, v_r.inventory_item_id, v_r.total_qty,
              'Auto: order ' || coalesce(v_short, '') || ' cancelled — stock restored');
    end loop;
  exception when others then
    -- Same rule as the forward deduction: stock bookkeeping can never block
    -- or fail a cancellation.
    null;
  end;
end $$;

-- Internal only — called from cancel_order below, never invoked directly by
-- a client, so no grant to anon or authenticated.
revoke execute on function reverse_stock_for_cancelled_order(uuid) from public, anon, authenticated;

create or replace function cancel_order(p_order_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id       uuid;
  v_status        order_status;
  v_payment_status payment_status;
  v_role          member_role;
begin
  select cafe_id, status, payment_status into v_cafe_id, v_status, v_payment_status
    from orders where id = p_order_id;
  if v_cafe_id is null then raise exception 'order not found'; end if;

  select role into v_role from cafe_members where cafe_id = v_cafe_id and user_id = auth.uid();
  if v_role is null then raise exception 'not authorized for this café'; end if;

  if v_status in ('completed', 'cancelled') then
    raise exception 'this order is already % and cannot be cancelled', v_status;
  end if;

  if v_payment_status in ('paid', 'partial') then
    raise exception 'this order has payment recorded against it — cancelling it needs a refund (not available yet); reverse the payment with a manager first';
  end if;

  if v_status in ('preparing', 'ready', 'served') and v_role not in ('owner', 'manager') then
    raise exception 'the kitchen has already started this order — a manager or owner needs to cancel it';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'a cancellation reason is required';
  end if;

  update orders set status = 'cancelled', cancel_reason = trim(p_reason) where id = p_order_id;

  perform reverse_stock_for_cancelled_order(p_order_id);
end $$;

revoke execute on function cancel_order(uuid, text) from public, anon;
grant execute on function cancel_order(uuid, text) to authenticated;
