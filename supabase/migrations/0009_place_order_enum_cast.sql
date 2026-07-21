-- 0009 — Cast p_payment_method to the enum in place_order.
-- orders.payment_method became an enum (0006) after the function was written;
-- text PARAMETERS (unlike literals) don't auto-coerce into enum columns, so
-- every live order failed with: column "payment_method" is of type
-- payment_method but expression is of type text. Full recreate with the cast.

create or replace function place_order(
  p_token          text,
  p_items          jsonb,
  p_phone          text default null,
  p_payment_method text default 'counter',
  p_upsell_item_id uuid default null,
  p_upsell_shown   boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id      uuid;
  v_table_id     uuid;
  v_order_id     uuid;
  v_subtotal     integer := 0;
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
  v_upsell_taken boolean := false;
  v_upsell_value integer := 0;
begin
  if p_payment_method not in ('upi','counter') then
    raise exception 'invalid payment method';
  end if;

  select id, cafe_id into v_table_id, v_cafe_id from cafe_tables where token = p_token;
  if v_cafe_id is null then raise exception 'invalid table'; end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'empty order';
  end if;

  v_day_start := (date_trunc('day', (now() at time zone 'Asia/Kolkata')) at time zone 'Asia/Kolkata');
  select count(*) + 1 into v_seq from orders
    where cafe_id = v_cafe_id and status <> 'cancelled' and created_at >= v_day_start;

  insert into orders (cafe_id, table_id, short_code, type, status, payment_status,
                      phone, payment_method, subtotal, total, upsell_shown)
    values (v_cafe_id, v_table_id, v_seq::text, 'dine_in', 'placed', 'unpaid',
            p_phone, p_payment_method::payment_method, 0, 0, coalesce(p_upsell_shown, false))
    returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(1, coalesce((v_item->>'qty')::int, 1));

    select id, name, price into v_id, v_name, v_price
      from menu_items
      where id = (v_item->>'item_id')::uuid
        and cafe_id = v_cafe_id and available = true and archived = false;
    if v_id is null then raise exception 'item not available'; end if;

    v_unit := v_price;
    v_mods := '[]'::jsonb;

    v_has_variants := exists (select 1 from menu_item_variants where menu_item_id = v_id);
    v_variant_id := nullif(v_item->>'variant_id','')::uuid;
    if v_has_variants and v_variant_id is null then
      raise exception 'variant required';
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

    if p_upsell_item_id is not null and v_id = p_upsell_item_id then
      v_upsell_taken := true;
      v_upsell_value := v_unit * v_qty;
    end if;
  end loop;

  update orders
    set subtotal = v_subtotal, total = v_subtotal,
        upsell_item_id = p_upsell_item_id, upsell_taken = v_upsell_taken, upsell_value = v_upsell_value
    where id = v_order_id;

  return jsonb_build_object('short_code', v_seq::text, 'total', v_subtotal);
end $$;

grant execute on function place_order(text, jsonb, text, text, uuid, boolean) to anon, authenticated;
