-- ============================================================================
-- 0002 — Secure order placement (Phase 11: server-side price validation).
--
-- Customers are anonymous. Instead of granting anon INSERT on orders (forgeable),
-- all order creation goes through this SECURITY DEFINER function. It:
--   * resolves the café + table from the QR token (server-side),
--   * looks up AUTHORITATIVE prices from menu_items (ignores anything the client
--     sends — DevTools cannot change the total),
--   * verifies each item is available and belongs to that café,
--   * snapshots name + price into order_items,
--   * returns the order number + total.
-- Runs as definer so it can insert despite RLS, but only ever for the café that
-- owns the scanned token — no cross-tenant path.
-- ============================================================================

create or replace function place_order(
  p_token          text,
  p_items          jsonb,               -- [{"item_id":"uuid","qty":2}, ...]
  p_phone          text default null,
  p_payment_method text default 'counter',
  p_upsell_item_id uuid default null,
  p_upsell_shown   boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id     uuid;
  v_table_id    uuid;
  v_order_id    uuid;
  v_subtotal    integer := 0;
  v_seq         integer;
  v_day_start   timestamptz;
  v_item        jsonb;
  v_qty         integer;
  v_price       integer;
  v_name        text;
  v_id          uuid;
  v_upsell_taken boolean := false;
  v_upsell_value integer := 0;
begin
  if p_payment_method not in ('upi','counter') then
    raise exception 'invalid payment method';
  end if;

  select id, cafe_id into v_table_id, v_cafe_id from cafe_tables where token = p_token;
  if v_cafe_id is null then
    raise exception 'invalid table';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'empty order';
  end if;

  -- Per-café daily order number, reset at IST midnight.
  v_day_start := (date_trunc('day', (now() at time zone 'Asia/Kolkata')) at time zone 'Asia/Kolkata');
  select count(*) + 1 into v_seq from orders
    where cafe_id = v_cafe_id and status <> 'cancelled' and created_at >= v_day_start;

  insert into orders (cafe_id, table_id, short_code, type, status, payment_status,
                      phone, payment_method, subtotal, total, upsell_shown)
    values (v_cafe_id, v_table_id, v_seq::text, 'dine_in', 'placed', 'unpaid',
            p_phone, p_payment_method, 0, 0, coalesce(p_upsell_shown, false))
    returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(1, coalesce((v_item->>'qty')::int, 1));
    -- Authoritative lookup: price comes from the DB, scoped to this café, must be live.
    select id, name, price into v_id, v_name, v_price
      from menu_items
      where id = (v_item->>'item_id')::uuid
        and cafe_id = v_cafe_id and available = true and archived = false;
    if v_id is null then
      raise exception 'item not available';
    end if;

    insert into order_items (order_id, menu_item_id, name, price, qty)
      values (v_order_id, v_id, v_name, v_price, v_qty);
    v_subtotal := v_subtotal + v_price * v_qty;

    if p_upsell_item_id is not null and v_id = p_upsell_item_id then
      v_upsell_taken := true;
      v_upsell_value := v_price * v_qty;
    end if;
  end loop;

  update orders
    set subtotal = v_subtotal, total = v_subtotal,
        upsell_item_id = p_upsell_item_id, upsell_taken = v_upsell_taken, upsell_value = v_upsell_value
    where id = v_order_id;

  return jsonb_build_object('short_code', v_seq::text, 'total', v_subtotal);
end $$;

-- Anonymous customers (and staff) may call it; the function is the only write path.
grant execute on function place_order(text, jsonb, text, text, uuid, boolean) to anon, authenticated;
