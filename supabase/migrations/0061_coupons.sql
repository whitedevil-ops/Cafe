-- ============================================================================
-- 0061 — Coupons & Offers: real server-side validation and redemption.
--
-- THE GAP: coupons / coupon_redemptions have existed since schema.sql with a
-- solid shape, but nothing in the app ever read or wrote them — a café could
-- create a coupon row and it would do precisely nothing. This migration is
-- the entire missing engine: one shared resolver, two preview wrappers (one
-- per caller — POS is authenticated, the QR customer is anon), and both
-- order-placement RPCs extended to actually apply and redeem a coupon.
--
-- SCOPE: only kind = 'percent' | 'flat' are handled automatically here — the
-- exact two kinds named in the product spec ("percentage/flat, server-side
-- validation, usage limits, no trusting frontend discount amounts"). 'bogo',
-- 'free_item' and 'min_order' need their own redemption semantics (which
-- specific item is free? which line is the "buy" vs the "get"?) that were
-- never specified — a coupon of one of those kinds is refused with a clear
-- message rather than silently mis-applying a discount.
--
-- WHY DISCOUNT IS ALWAYS RECOMPUTED HERE, NEVER READ FROM THE CLIENT: the
-- client only ever sends a coupon CODE. The amount it takes off is resolved
-- from the coupons table and the subtotal apply_order_taxes has already
-- computed from real order_items rows — a browser cannot claim a bigger
-- discount than the coupon actually grants, because it never gets to name
-- the number at all.
-- ============================================================================

-- coupon_redemptions never stored the discount it actually granted — only
-- coupon_id/order_id. Needed so a stacked manual-discount-plus-coupon order
-- doesn't misattribute the whole order.discount to the coupon in reporting.
alter table coupon_redemptions add column if not exists discount_amount integer not null default 0;

-- ── The one place eligibility + amount are computed ────────────────────────
-- Stable, not volatile — a redemption is written by the CALLER (place_order /
-- staff_place_order), never by this function itself, so it is safe to call
-- freely from a preview without side effects.
create or replace function resolve_coupon_discount(
  p_cafe_id      uuid,
  p_code         text,
  p_subtotal     integer,
  p_customer_id  uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_coupon  coupons%rowtype;
  v_used    integer;
  v_by_cust integer;
  v_disc    integer;
begin
  if p_code is null or trim(p_code) = '' then
    raise exception 'enter a coupon code';
  end if;

  select * into v_coupon from coupons
    where cafe_id = p_cafe_id and upper(code) = upper(trim(p_code));
  if v_coupon.id is null then
    raise exception 'coupon "%" was not found', trim(p_code);
  end if;

  if not v_coupon.active then
    raise exception 'coupon "%" is no longer active', v_coupon.code;
  end if;
  if v_coupon.starts_at is not null and now() < v_coupon.starts_at then
    raise exception 'coupon "%" is not active yet', v_coupon.code;
  end if;
  if v_coupon.ends_at is not null and now() > v_coupon.ends_at then
    raise exception 'coupon "%" has expired', v_coupon.code;
  end if;
  if v_coupon.kind not in ('percent', 'flat') then
    raise exception 'coupon "%" needs to be applied manually by staff', v_coupon.code;
  end if;
  if p_subtotal < v_coupon.min_order then
    raise exception 'coupon "%" needs a minimum order of ₹%', v_coupon.code, v_coupon.min_order;
  end if;

  if v_coupon.usage_limit is not null then
    select count(*) into v_used from coupon_redemptions where coupon_id = v_coupon.id;
    if v_used >= v_coupon.usage_limit then
      raise exception 'coupon "%" has reached its usage limit', v_coupon.code;
    end if;
  end if;

  if v_coupon.per_customer is not null and p_customer_id is not null then
    select count(*) into v_by_cust
      from coupon_redemptions where coupon_id = v_coupon.id and customer_id = p_customer_id;
    if v_by_cust >= v_coupon.per_customer then
      raise exception 'coupon "%" has already been used the maximum number of times on this number', v_coupon.code;
    end if;
  end if;

  if v_coupon.kind = 'percent' then
    v_disc := round(p_subtotal * least(greatest(v_coupon.value, 0), 100) / 100.0);
    if v_coupon.max_discount is not null then
      v_disc := least(v_disc, v_coupon.max_discount);
    end if;
  else
    v_disc := v_coupon.value;
  end if;
  v_disc := greatest(0, least(v_disc, p_subtotal));

  return jsonb_build_object(
    'coupon_id', v_coupon.id, 'code', v_coupon.code, 'name', v_coupon.name,
    'kind', v_coupon.kind, 'discount', v_disc);
end $$;

revoke execute on function resolve_coupon_discount(uuid, text, integer, uuid) from public, anon;
grant execute on function resolve_coupon_discount(uuid, text, integer, uuid) to authenticated;

-- ── POS / staff preview (authenticated) ────────────────────────────────────
create or replace function validate_coupon(
  p_cafe_id        uuid,
  p_code           text,
  p_subtotal       integer,
  p_customer_phone text default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_phone       text;
  v_customer_id uuid;
begin
  if not is_cafe_member(p_cafe_id) then
    raise exception 'not authorized for this café';
  end if;
  v_phone := nullif(regexp_replace(coalesce(p_customer_phone, ''), '\D', '', 'g'), '');
  if v_phone is not null then
    select id into v_customer_id from customers where cafe_id = p_cafe_id and phone = v_phone;
  end if;
  return resolve_coupon_discount(p_cafe_id, p_code, p_subtotal, v_customer_id);
end $$;

revoke execute on function validate_coupon(uuid, text, integer, text) from public, anon;
grant execute on function validate_coupon(uuid, text, integer, text) to authenticated;

-- ── QR customer preview (anon) — resolves the café from the table token, ──
-- exactly like place_order does, so an anonymous customer never needs to
-- know or guess a cafe_id.
create or replace function validate_coupon_public(
  p_token          text,
  p_code           text,
  p_subtotal       integer,
  p_customer_phone text default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_cafe_id     uuid;
  v_phone       text;
  v_customer_id uuid;
begin
  select cafe_id into v_cafe_id from cafe_tables where token = p_token;
  if v_cafe_id is null then raise exception 'invalid table'; end if;

  v_phone := nullif(regexp_replace(coalesce(p_customer_phone, ''), '\D', '', 'g'), '');
  if v_phone is not null then
    select id into v_customer_id from customers where cafe_id = v_cafe_id and phone = v_phone;
  end if;
  return resolve_coupon_discount(v_cafe_id, p_code, p_subtotal, v_customer_id);
end $$;

revoke execute on function validate_coupon_public(text, text, integer, text) from public;
grant execute on function validate_coupon_public(text, text, integer, text) to anon, authenticated;

-- ── place_order: real redemption, not just preview ─────────────────────────
-- Adding a parameter changes the signature — drop the old one first, same
-- PGRST203-overload trap documented in 0056.
drop function if exists place_order(text, jsonb, text, text, uuid, boolean, uuid);

create or replace function place_order(
  p_token             text,
  p_items             jsonb,
  p_phone             text default null,
  p_payment_method    text default 'counter',
  p_upsell_item_id    uuid default null,
  p_upsell_shown      boolean default false,
  p_client_request_id uuid default null,
  p_coupon_code       text default null
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
  v_note         text;
  v_has_variants boolean;
  v_variant_id   uuid;
  v_vname        text;
  v_vdelta       integer;
  v_addon        text;
  v_aname        text;
  v_aprice       integer;
  v_upsell_taken boolean := false;
  v_upsell_value integer := 0;
  v_tax          integer;
  v_svc          integer;
  v_total        integer;
  v_discount     integer;
  v_existing     record;
  v_coupon       jsonb;
  v_coupon_disc  integer := 0;
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

  if p_client_request_id is not null then
    select short_code, total, receipt_token into v_existing
      from orders where cafe_id = v_cafe_id and client_request_id = p_client_request_id;
    if found then
      return jsonb_build_object('short_code', v_existing.short_code, 'total', v_existing.total,
                                 'receipt_token', v_existing.receipt_token);
    end if;
  end if;

  v_session_id := get_or_create_session(v_cafe_id, v_table_id);

  if v_phone is not null then
    insert into customers (cafe_id, phone, last_seen)
    values (v_cafe_id, v_phone, now())
    on conflict (cafe_id, phone) do update set last_seen = now()
    returning id into v_customer_id;
  end if;

  v_day_start := cafe_day_start(v_cafe_id);
  select count(*) + 1 into v_seq from orders
    where cafe_id = v_cafe_id and status <> 'cancelled' and created_at >= v_day_start;

  insert into orders (cafe_id, table_id, session_id, customer_id, short_code, type, status, payment_status,
                      phone, payment_method, subtotal, total, upsell_shown, source, client_request_id)
    values (v_cafe_id, v_table_id, v_session_id, v_customer_id, v_seq::text, 'dine_in', 'placed', 'unpaid',
            v_phone, p_payment_method::payment_method, 0, 0, coalesce(p_upsell_shown, false), 'qr', p_client_request_id)
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

    v_note := nullif(trim(left(coalesce(v_item->>'note', ''), 140)), '');

    insert into order_items (order_id, menu_item_id, name, price, qty, modifiers, instructions)
      values (v_order_id, v_id, v_name, v_unit, v_qty, v_mods, v_note);
    v_subtotal := v_subtotal + v_unit * v_qty;

    if p_upsell_item_id is not null and v_id = p_upsell_item_id then
      v_upsell_taken := true;
      v_upsell_value := v_unit * v_qty;
    end if;
  end loop;

  if p_coupon_code is not null and trim(p_coupon_code) <> '' then
    v_coupon := resolve_coupon_discount(v_cafe_id, p_coupon_code, v_subtotal, v_customer_id);
    v_coupon_disc := (v_coupon->>'discount')::integer;
  end if;

  select t.subtotal, t.discount, t.tax, t.service_charge, t.total
    into v_subtotal, v_discount, v_tax, v_svc, v_total
    from apply_order_taxes(v_order_id, v_coupon_disc) t;

  update orders
     set upsell_item_id = p_upsell_item_id,
         upsell_taken   = v_upsell_taken,
         upsell_value   = v_upsell_value,
         coupon_code    = case when v_coupon is not null then v_coupon->>'code' end
   where id = v_order_id;

  if v_coupon is not null then
    insert into coupon_redemptions (cafe_id, coupon_id, order_id, customer_id, discount_amount)
    values (v_cafe_id, (v_coupon->>'coupon_id')::uuid, v_order_id, v_customer_id, v_coupon_disc);
  end if;

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (v_cafe_id, null, 'order.created', 'orders', v_order_id,
          jsonb_build_object('source', 'qr', 'total', v_total, 'table_id', v_table_id));

  insert into notifications (cafe_id, type, message, table_id, session_id)
  select v_cafe_id, 'new_order', 'Table ' || t.label || ' placed a new order — #' || v_seq, v_table_id, v_session_id
  from cafe_tables t where t.id = v_table_id;

  return jsonb_build_object('short_code', v_seq::text, 'total', v_total, 'receipt_token', v_receipt, 'discount', v_discount);
exception
  when unique_violation then
    if p_client_request_id is not null then
      select short_code, total, receipt_token into v_existing
        from orders where cafe_id = v_cafe_id and client_request_id = p_client_request_id;
      if found then
        return jsonb_build_object('short_code', v_existing.short_code, 'total', v_existing.total,
                                   'receipt_token', v_existing.receipt_token);
      end if;
    end if;
    raise;
end $$;

grant execute on function place_order(text, jsonb, text, text, uuid, boolean, uuid, text) to anon, authenticated;

-- ── staff_place_order: real redemption, on top of any manual discount ──────
drop function if exists staff_place_order(uuid, jsonb, order_type, uuid, text, text, text, text, numeric, boolean, text, uuid);

create or replace function staff_place_order(
  p_cafe_id           uuid,
  p_items             jsonb,
  p_order_type        order_type default 'dine_in',
  p_table_id          uuid default null,
  p_payment_method    text default 'counter',
  p_customer_phone    text default null,
  p_customer_name     text default null,
  p_discount_type     text default null,
  p_discount_value    numeric default 0,
  p_settle            boolean default false,
  p_pending_reason    text default null,
  p_client_request_id uuid default null,
  p_coupon_code       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role         member_role;
  v_max_pct      numeric;
  v_session_id   uuid;
  v_customer_id  uuid;
  v_phone        text;
  v_order_id     uuid;
  v_receipt      uuid;
  v_subtotal     integer := 0;
  v_discount     integer := 0;
  v_disc_pct_eq  numeric;
  v_tax          integer;
  v_svc          integer;
  v_total        integer;
  v_seq          integer;
  v_day_start    timestamptz;
  v_item         jsonb;
  v_qty          integer;
  v_id           uuid;
  v_name         text;
  v_price        integer;
  v_unit         integer;
  v_mods         jsonb;
  v_note         text;
  v_has_variants boolean;
  v_variant_id   uuid;
  v_vname        text;
  v_vdelta       integer;
  v_addon        text;
  v_aname        text;
  v_aprice       integer;
  v_settled      boolean := false;
  v_existing     record;
  v_coupon       jsonb;
  v_coupon_disc  integer := 0;
begin
  select role into v_role from cafe_members where cafe_id = p_cafe_id and user_id = auth.uid();
  if v_role is null then
    raise exception 'not authorized for this café';
  end if;
  if p_order_type not in ('dine_in', 'takeaway') then
    raise exception 'invalid order type';
  end if;
  if p_payment_method not in ('counter', 'cash', 'card', 'upi') then
    raise exception 'invalid payment method';
  end if;
  if p_order_type = 'dine_in' and p_table_id is null then
    raise exception 'table required for a dine-in order';
  end if;
  if p_order_type = 'takeaway' and p_table_id is not null then
    raise exception 'a takeaway order must not be attached to a table';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'empty order';
  end if;

  if p_client_request_id is not null then
    select id, short_code, subtotal, discount, tax, service_charge, total, receipt_token, payment_status
      into v_existing
      from orders where cafe_id = p_cafe_id and client_request_id = p_client_request_id;
    if found then
      return jsonb_build_object('order_id', v_existing.id, 'short_code', v_existing.short_code,
                                 'subtotal', v_existing.subtotal, 'discount', v_existing.discount,
                                 'tax', v_existing.tax, 'service_charge', v_existing.service_charge,
                                 'total', v_existing.total, 'receipt_token', v_existing.receipt_token,
                                 'settled', v_existing.payment_status = 'paid',
                                 'payment_status', v_existing.payment_status);
    end if;
  end if;

  if p_order_type = 'dine_in' then
    v_session_id := get_or_create_session(p_cafe_id, p_table_id);
  end if;

  v_phone := nullif(regexp_replace(coalesce(p_customer_phone, ''), '\D', '', 'g'), '');
  if v_phone is not null and v_phone !~ '^[6-9][0-9]{9}$' then
    raise exception 'invalid phone number';
  end if;
  if v_phone is not null then
    insert into customers (cafe_id, phone, name, last_seen)
    values (p_cafe_id, v_phone, nullif(trim(coalesce(p_customer_name, '')), ''), now())
    on conflict (cafe_id, phone) do update
      set last_seen = now(),
          name = coalesce(nullif(trim(coalesce(p_customer_name, '')), ''), customers.name)
    returning id into v_customer_id;
  end if;

  v_day_start := cafe_day_start(p_cafe_id);
  select count(*) + 1 into v_seq from orders
    where cafe_id = p_cafe_id and status <> 'cancelled' and created_at >= v_day_start;

  insert into orders (cafe_id, table_id, session_id, customer_id, short_code, type, status,
                      payment_status, phone, payment_method, staff_id, subtotal, total, source, client_request_id)
    values (p_cafe_id, p_table_id, v_session_id, v_customer_id, v_seq::text, p_order_type, 'placed',
            'unpaid', v_phone, p_payment_method::payment_method, auth.uid(), 0, 0, 'pos', p_client_request_id)
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

    v_note := nullif(trim(coalesce(v_item->>'note', '')), '');

    insert into order_items (order_id, menu_item_id, name, price, qty, modifiers, instructions)
      values (v_order_id, v_id, v_name, v_unit, v_qty, v_mods, v_note);
    v_subtotal := v_subtotal + v_unit * v_qty;
  end loop;

  v_max_pct := case v_role when 'owner' then 100 when 'manager' then 15 else 5 end;

  if p_discount_type is not null and p_discount_type not in ('percent', 'flat') then
    raise exception 'invalid discount type';
  end if;

  if p_discount_type = 'percent' and p_discount_value > 0 then
    if p_discount_value > v_max_pct then
      raise exception 'your role can discount at most % percent (requested %)', v_max_pct, p_discount_value;
    end if;
    v_discount := round(v_subtotal * p_discount_value / 100.0);
  elsif p_discount_type = 'flat' and p_discount_value > 0 then
    v_disc_pct_eq := case when v_subtotal > 0 then (p_discount_value * 100.0 / v_subtotal) else 0 end;
    if v_disc_pct_eq > v_max_pct then
      raise exception 'your role can discount at most % percent of the subtotal', v_max_pct;
    end if;
    v_discount := round(p_discount_value);
  end if;

  -- Coupon discount stacks on top of any manual staff discount — the total
  -- taken off is still hard-capped to the subtotal by apply_order_taxes.
  if p_coupon_code is not null and trim(p_coupon_code) <> '' then
    v_coupon := resolve_coupon_discount(p_cafe_id, p_coupon_code, v_subtotal, v_customer_id);
    v_coupon_disc := (v_coupon->>'discount')::integer;
    v_discount := v_discount + v_coupon_disc;
  end if;

  if v_discount > 0 then
    insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
    values (p_cafe_id, auth.uid(), 'order.discount_applied', 'orders', v_order_id,
            jsonb_build_object('type', p_discount_type, 'requested', p_discount_value,
                                'amount', v_discount, 'role', v_role,
                                'coupon_code', case when v_coupon is not null then v_coupon->>'code' end));
  end if;

  select t.subtotal, t.discount, t.tax, t.service_charge, t.total
    into v_subtotal, v_discount, v_tax, v_svc, v_total
    from apply_order_taxes(v_order_id, v_discount) t;

  if v_coupon is not null then
    update orders set coupon_code = v_coupon->>'code' where id = v_order_id;
    insert into coupon_redemptions (cafe_id, coupon_id, order_id, customer_id, discount_amount)
    values (p_cafe_id, (v_coupon->>'coupon_id')::uuid, v_order_id, v_customer_id, v_coupon_disc);
  end if;

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (p_cafe_id, auth.uid(), 'order.created', 'orders', v_order_id,
          jsonb_build_object('source', 'pos', 'total', v_total, 'order_type', p_order_type, 'table_id', p_table_id));

  if p_settle then
    if p_payment_method not in ('cash', 'card', 'upi') then
      raise exception 'to collect payment now, choose cash, card or UPI';
    end if;
    if v_total > 0 then
      perform record_payment(v_order_id, v_total, p_payment_method, null, 'pos', null);
      v_settled := true;
    end if;
  else
    update orders set payment_method = 'counter' where id = v_order_id;
    if p_order_type = 'takeaway' then
      insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
      values (p_cafe_id, auth.uid(), 'order.payment_pending', 'orders', v_order_id,
              jsonb_build_object('reason', nullif(trim(coalesce(p_pending_reason, '')), ''),
                                 'total', v_total, 'order_type', p_order_type));
    end if;
  end if;

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
                            'subtotal', v_subtotal, 'discount', v_discount,
                            'tax', v_tax, 'service_charge', v_svc,
                            'total', v_total, 'receipt_token', v_receipt,
                            'settled', v_settled,
                            'payment_status', (select payment_status from orders where id = v_order_id));
exception
  when unique_violation then
    if p_client_request_id is not null then
      select id, short_code, subtotal, discount, tax, service_charge, total, receipt_token, payment_status
        into v_existing
        from orders where cafe_id = p_cafe_id and client_request_id = p_client_request_id;
      if found then
        return jsonb_build_object('order_id', v_existing.id, 'short_code', v_existing.short_code,
                                   'subtotal', v_existing.subtotal, 'discount', v_existing.discount,
                                   'tax', v_existing.tax, 'service_charge', v_existing.service_charge,
                                   'total', v_existing.total, 'receipt_token', v_existing.receipt_token,
                                   'settled', v_existing.payment_status = 'paid',
                                   'payment_status', v_existing.payment_status);
      end if;
    end if;
    raise;
end $$;

revoke execute on function staff_place_order(uuid, jsonb, order_type, uuid, text, text, text, text, numeric, boolean, text, uuid, text) from public, anon;
grant execute on function staff_place_order(uuid, jsonb, order_type, uuid, text, text, text, text, numeric, boolean, text, uuid, text) to authenticated;

-- ── Redemption stats for the coupon management UI ──────────────────────────
create or replace function coupon_stats(p_cafe_id uuid)
returns table(coupon_id uuid, redemptions integer, total_discounted integer, last_used_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_cafe_member(p_cafe_id) then raise exception 'not authorized'; end if;
  return query
    select cr.coupon_id, count(*)::integer,
           coalesce(sum(cr.discount_amount), 0)::integer,
           max(cr.created_at)
      from coupon_redemptions cr
     where cr.cafe_id = p_cafe_id
     group by cr.coupon_id;
end $$;

revoke execute on function coupon_stats(uuid) from public, anon;
grant execute on function coupon_stats(uuid) to authenticated;
