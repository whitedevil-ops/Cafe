-- ============================================================================
-- 0025 — Two small additions the redesigned customer QR menu needs.
--
-- SCOPE DISCIPLINE: this migration does NOT touch order totals, tax, discount
-- or service-charge maths (compute_bill is untouched), does not change any RLS
-- policy, and does not alter tenant isolation. place_order is modified in
-- exactly one way — it now writes an optional per-item note into the existing
-- order_items.instructions column, which the POS path (staff_place_order) has
-- written since 0016. This makes the two order paths consistent rather than
-- adding a QR-only concept.
-- ============================================================================

-- ── 1. "Popular" category, derived from real sales ─────────────────────────
-- The menu has is_bestseller (owner-set) but no popularity flag, and adding
-- one would need owner-side UI that is explicitly out of scope for this
-- redesign. Real order history is a better signal than a manual flag anyway:
-- it self-maintains and cannot go stale.
--
-- SECURITY DEFINER because anon cannot read `orders` (member-only RLS), but
-- the function discloses nothing beyond a ranked list of menu item ids for a
-- café whose public menu the caller is already looking at. Sales counts are
-- deliberately NOT returned — ranking is all the UI needs, so that is all it
-- gets.
create or replace function public_popular_items(p_cafe_id uuid, p_limit integer default 12)
returns table (menu_item_id uuid)
language sql stable security definer set search_path = public as $$
  select oi.menu_item_id
  from order_items oi
  join orders o on o.id = oi.order_id
  join menu_items mi on mi.id = oi.menu_item_id
  where o.cafe_id = p_cafe_id
    and o.status <> 'cancelled'
    and o.created_at > now() - interval '30 days'
    and oi.menu_item_id is not null
    and mi.archived = false
  group by oi.menu_item_id
  order by sum(oi.qty) desc, oi.menu_item_id
  limit greatest(coalesce(p_limit, 12), 1);
$$;

revoke execute on function public_popular_items(uuid, integer) from public;
grant execute on function public_popular_items(uuid, integer) to anon, authenticated;

-- ── 2. place_order v8 — per-item special instructions ──────────────────────
-- Identical to the 0019 version except for the two lines marked NEW. Restated
-- in full because `create or replace function` cannot patch a body.
create or replace function place_order(
  p_token          text,
  p_items          jsonb,           -- [{item_id, qty, variant_id?, addon_ids?, note?}]
  p_phone          text default null,
  p_payment_method text default 'counter',
  p_upsell_item_id uuid default null,
  p_upsell_shown   boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id      uuid;
  v_cafe_status  text;
  v_table_id     uuid;
  v_session_id   uuid;
  v_order_id     uuid;
  v_customer_id  uuid;
  v_phone        text;
  v_receipt      uuid;
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
  v_note         text;            -- NEW
  v_has_variants boolean;
  v_variant_id   uuid;
  v_vname        text;
  v_vdelta       integer;
  v_addon        text;
  v_aname        text;
  v_aprice       integer;
  v_upsell_taken boolean := false;
  v_upsell_value integer := 0;
  v_base         integer;
  v_tax          integer;
  v_svc          integer;
  v_total        integer;
begin
  if p_payment_method not in ('counter','cash','card') then
    raise exception 'invalid payment method';
  end if;

  v_phone := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
  if v_phone is not null and v_phone !~ '^[6-9][0-9]{9}$' then
    raise exception 'invalid phone number';
  end if;

  select id, cafe_id into v_table_id, v_cafe_id from cafe_tables where token = p_token;
  if v_cafe_id is null then raise exception 'invalid table'; end if;

  select status into v_cafe_status from cafes where id = v_cafe_id;
  if v_cafe_status <> 'active' then raise exception 'this café is not currently accepting orders'; end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'empty order';
  end if;

  v_session_id := get_or_create_session(v_cafe_id, v_table_id);

  if v_phone is not null then
    insert into customers (cafe_id, phone, last_seen)
    values (v_cafe_id, v_phone, now())
    on conflict (cafe_id, phone) do update set last_seen = now()
    returning id into v_customer_id;
  end if;

  v_day_start := (date_trunc('day', (now() at time zone 'Asia/Kolkata')) at time zone 'Asia/Kolkata');
  select count(*) + 1 into v_seq from orders
    where cafe_id = v_cafe_id and status <> 'cancelled' and created_at >= v_day_start;

  insert into orders (cafe_id, table_id, session_id, customer_id, short_code, type, status, payment_status,
                      phone, payment_method, subtotal, total, upsell_shown, source)
    values (v_cafe_id, v_table_id, v_session_id, v_customer_id, v_seq::text, 'dine_in', 'placed', 'unpaid',
            v_phone, p_payment_method::payment_method, 0, 0, coalesce(p_upsell_shown, false), 'qr')
    returning id, receipt_token into v_order_id, v_receipt;

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

    -- NEW: trimmed, length-capped so a pasted essay cannot bloat a KOT ticket.
    v_note := nullif(trim(left(coalesce(v_item->>'note', ''), 140)), '');

    insert into order_items (order_id, menu_item_id, name, price, qty, modifiers, instructions)
      values (v_order_id, v_id, v_name, v_unit, v_qty, v_mods, v_note);
    v_subtotal := v_subtotal + v_unit * v_qty;

    if p_upsell_item_id is not null and v_id = p_upsell_item_id then
      v_upsell_taken := true;
      v_upsell_value := v_unit * v_qty;
    end if;
  end loop;

  select * into v_base, v_tax, v_svc, v_total from compute_bill(v_cafe_id, v_subtotal, 0);

  update orders
    set subtotal = v_subtotal, tax = v_tax, service_charge = v_svc, total = v_total,
        upsell_item_id = p_upsell_item_id, upsell_taken = v_upsell_taken, upsell_value = v_upsell_value
    where id = v_order_id;

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (v_cafe_id, null, 'order.created', 'orders', v_order_id,
          jsonb_build_object('source', 'qr', 'total', v_total, 'table_id', v_table_id));

  insert into notifications (cafe_id, type, message, table_id, session_id)
  select v_cafe_id, 'new_order', 'Table ' || t.label || ' placed a new order — #' || v_seq, v_table_id, v_session_id
  from cafe_tables t where t.id = v_table_id;

  return jsonb_build_object('short_code', v_seq::text, 'total', v_total, 'receipt_token', v_receipt);
end $$;

grant execute on function place_order(text, jsonb, text, text, uuid, boolean) to anon, authenticated;
