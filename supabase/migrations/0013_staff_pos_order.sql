-- ============================================================================
-- 0013 — Staff-side order creation for the new cashier POS screen.
--
-- The customer QR flow (place_order) is anon-callable via a table token and
-- always requires a phone. Staff taking an order at the counter are already
-- authenticated cafe_members — they don't need a token or a phone, and they
-- can do dine-in (attaches to a table session, reusing get_or_create_session
-- from 0012) or takeaway (no table, no session). Same non-negotiable rule as
-- the customer path: prices are looked up from menu_items server-side and
-- never trusted from the client, so a compromised or buggy POS tab can't
-- under-charge or fabricate a total.
-- ============================================================================

-- Defensive: staff_id is in the canonical schema.sql but this project has
-- repeatedly drifted between that file and what actually applied to prod.
alter table orders add column if not exists staff_id uuid references profiles(id) on delete set null;

create or replace function staff_place_order(
  p_cafe_id        uuid,
  p_items          jsonb,           -- [{item_id, qty, variant_id?, addon_ids?}]
  p_order_type     order_type default 'dine_in',
  p_table_id       uuid default null,
  p_payment_method text default 'counter',
  p_customer_phone text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_session_id   uuid;
  v_customer_id  uuid;
  v_phone        text;
  v_order_id     uuid;
  v_receipt      uuid;
  v_subtotal     integer := 0;
  v_tax_pct      numeric;
  v_svc_pct      numeric;
  v_tax          integer;
  v_svc          integer;
  v_seq          integer;
  v_day_start    timestamptz;
  v_item         jsonb;
  v_qty          integer;
  v_id           uuid;
  v_name         text;
  v_price        integer;
  v_unit         integer;
  v_mods         jsonb;
  v_has_variants boolean;
  v_variant_id   uuid;
  v_vname        text;
  v_vdelta       integer;
  v_addon        text;
  v_aname        text;
  v_aprice       integer;
begin
  if not is_cafe_member(p_cafe_id) then
    raise exception 'not authorized for this café';
  end if;
  if p_order_type not in ('dine_in', 'takeaway') then
    raise exception 'invalid order type';
  end if;
  if p_payment_method not in ('counter', 'cash', 'card') then
    raise exception 'invalid payment method';
  end if;
  if p_order_type = 'dine_in' and p_table_id is null then
    raise exception 'table required for a dine-in order';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'empty order';
  end if;

  if p_order_type = 'dine_in' then
    v_session_id := get_or_create_session(p_cafe_id, p_table_id);
  end if;

  v_phone := nullif(regexp_replace(coalesce(p_customer_phone, ''), '\D', '', 'g'), '');
  if v_phone is not null and v_phone !~ '^[6-9][0-9]{9}$' then
    raise exception 'invalid phone number';
  end if;
  if v_phone is not null then
    insert into customers (cafe_id, phone, last_seen)
    values (p_cafe_id, v_phone, now())
    on conflict (cafe_id, phone) do update set last_seen = now()
    returning id into v_customer_id;
  end if;

  v_day_start := (date_trunc('day', (now() at time zone 'Asia/Kolkata')) at time zone 'Asia/Kolkata');
  select count(*) + 1 into v_seq from orders
    where cafe_id = p_cafe_id and status <> 'cancelled' and created_at >= v_day_start;

  insert into orders (cafe_id, table_id, session_id, customer_id, short_code, type, status,
                      payment_status, phone, payment_method, staff_id, subtotal, total)
    values (p_cafe_id, p_table_id, v_session_id, v_customer_id, v_seq::text, p_order_type, 'placed',
            'unpaid', v_phone, p_payment_method::payment_method, auth.uid(), 0, 0)
    returning id, receipt_token into v_order_id, v_receipt;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(1, coalesce((v_item->>'qty')::int, 1));

    select id, name, price into v_id, v_name, v_price
      from menu_items
      where id = (v_item->>'item_id')::uuid
        and cafe_id = p_cafe_id and available = true and archived = false;
    if v_id is null then raise exception 'item not available'; end if;

    v_unit := v_price;
    v_mods := '[]'::jsonb;

    v_has_variants := exists (select 1 from menu_item_variants where menu_item_id = v_id);
    v_variant_id := nullif(v_item->>'variant_id', '')::uuid;
    if v_has_variants and v_variant_id is null then
      raise exception 'variant required for %', v_name;
    end if;
    if v_variant_id is not null then
      select name, price_delta into v_vname, v_vdelta
        from menu_item_variants where id = v_variant_id and menu_item_id = v_id;
      if v_vname is null then raise exception 'invalid variant'; end if;
      v_unit := v_unit + v_vdelta;
      v_mods := v_mods || jsonb_build_object('name', v_vname, 'price', v_vdelta);
      v_name := v_name || ' (' || v_vname || ')';
    end if;

    if v_item ? 'addon_ids' then
      for v_addon in select jsonb_array_elements_text(v_item->'addon_ids') loop
        select name, price into v_aname, v_aprice
          from menu_item_addons where id = v_addon::uuid and menu_item_id = v_id;
        if v_aname is null then raise exception 'invalid add-on'; end if;
        v_unit := v_unit + v_aprice;
        v_mods := v_mods || jsonb_build_object('name', v_aname, 'price', v_aprice);
      end loop;
    end if;

    insert into order_items (order_id, menu_item_id, name, price, qty, modifiers)
      values (v_order_id, v_id, v_name, v_unit, v_qty, v_mods);
    v_subtotal := v_subtotal + v_unit * v_qty;
  end loop;

  -- Apply the café's own tax/service-charge settings (Café Profile) — these
  -- columns have existed since that screen shipped but nothing computed them
  -- into a real order yet; this is that wiring, not a new promise.
  select tax_percent, service_charge into v_tax_pct, v_svc_pct from cafes where id = p_cafe_id;
  v_tax := round(v_subtotal * coalesce(v_tax_pct, 0) / 100.0);
  v_svc := round(v_subtotal * coalesce(v_svc_pct, 0) / 100.0);

  update orders set subtotal = v_subtotal, tax = v_tax, service_charge = v_svc,
                    total = v_subtotal + v_tax + v_svc
    where id = v_order_id;

  insert into notifications (cafe_id, type, message, table_id, session_id)
  select p_cafe_id, 'new_order',
         case when p_order_type = 'takeaway' then 'New takeaway order — #' || v_seq
              else 'Table ' || t.label || ' — new counter order #' || v_seq end,
         p_table_id, v_session_id
  from cafe_tables t where t.id = p_table_id
  union all
  select p_cafe_id, 'new_order', 'New takeaway order — #' || v_seq, null, null
  where p_table_id is null;

  return jsonb_build_object('order_id', v_order_id, 'short_code', v_seq::text,
                            'subtotal', v_subtotal, 'tax', v_tax, 'service_charge', v_svc,
                            'total', v_subtotal + v_tax + v_svc, 'receipt_token', v_receipt);
end $$;

grant execute on function staff_place_order(uuid, jsonb, order_type, uuid, text, text) to authenticated;
