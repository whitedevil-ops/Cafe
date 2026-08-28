-- ============================================================================
-- Phase 1 security lockdown, part 2 — two entitlement kill switches that only
-- ever hid a UI element, never blocked the actual server-side action.
-- ============================================================================

-- ── 1. qr_ordering kill switch: place_order never checked it.
--
-- public_cafe_ordering_enabled(p_table_token) already exists (0084) as a
-- deliberately anon-safe, membership-check-free entitlement check — its own
-- header explains cafe_has_feature() can't be reused for anon callers since
-- it requires is_cafe_member()/is_platform_admin(). It was only ever called
-- from app/t/[token]/page.tsx to decide whether to render the ordering UI.
-- place_order (the RPC that actually creates an order) only checked
-- cafes.status='active' — so toggling qr_ordering OFF in Feature Control
-- only hid the page; anyone who already had (or captured) that café's table
-- token could still place real orders by calling place_order directly.
--
-- Re-bodied from its 0154_todays_offer_pricing.sql definition, byte-for-byte
-- identical except the one new check, inserted right after the existing
-- cafe-status check (same place, same "is this café even allowed to take
-- orders right now" concern).
create or replace function place_order(
  p_token             text,
  p_items             jsonb,
  p_phone             text default null,
  p_payment_method    text default 'counter',
  p_upsell_item_id    uuid default null,
  p_upsell_shown      boolean default false,
  p_client_request_id uuid default null,
  p_coupon_code       text default null,
  p_device_id         text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id       uuid;
  v_cafe_status   text;
  v_table_id      uuid;
  v_session_id    uuid;
  v_order_id      uuid;
  v_customer_id   uuid;
  v_phone         text;
  v_receipt       uuid;
  v_subtotal      integer := 0;
  v_seq           integer;
  v_day_start     timestamptz;
  v_weekday       smallint;
  v_item          jsonb;
  v_qty           integer;
  v_id            uuid;
  v_name          text;
  v_price         integer;
  v_offer_price   integer;
  v_offer_days    integer[];
  v_unit          integer;
  v_mods          jsonb;
  v_note          text;
  v_has_variants  boolean;
  v_variant_id    uuid;
  v_vname         text;
  v_vdelta        integer;
  v_addon         text;
  v_aname         text;
  v_aprice        integer;
  v_upsell_taken  boolean := false;
  v_upsell_value  integer := 0;
  v_tax           integer;
  v_svc           integer;
  v_total         integer;
  v_discount      integer;
  v_existing      record;
  v_coupon        jsonb;
  v_coupon_disc   integer := 0;
  v_cat_ids       uuid[];
  v_combo_id      uuid;
  v_combo_savings integer := 0;
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

  -- NEW: the actual enforcement point for the qr_ordering kill switch —
  -- app/t/[token]/page.tsx already checks this to decide whether to render
  -- the page at all; this is what stops a captured/bookmarked table token
  -- from placing a real order while ops has paused ordering for this café.
  if not public_cafe_ordering_enabled(p_token) then
    raise exception 'ordering is currently paused for this café';
  end if;

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
  v_weekday := cafe_current_weekday(v_cafe_id);
  select count(*) + 1 into v_seq from orders
    where cafe_id = v_cafe_id and status <> 'cancelled' and created_at >= v_day_start;

  insert into orders (cafe_id, table_id, session_id, customer_id, short_code, type, status, payment_status,
                      phone, payment_method, subtotal, total, upsell_shown, source, client_request_id, device_id)
    values (v_cafe_id, v_table_id, v_session_id, v_customer_id, v_seq::text, 'dine_in', 'placed', 'unpaid',
            v_phone, p_payment_method::payment_method, 0, 0, coalesce(p_upsell_shown, false), 'qr', p_client_request_id,
            nullif(trim(coalesce(p_device_id, '')), ''))
    returning id, receipt_token into v_order_id, v_receipt;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(1, coalesce((v_item->>'qty')::int, 1));

    v_combo_id := nullif(v_item->>'combo_id', '')::uuid;
    if v_combo_id is not null then
      v_combo_savings := v_combo_savings + expand_combo_line(
        v_order_id, v_cafe_id, v_combo_id, coalesce(v_item->'selections', '[]'::jsonb), v_qty);
      continue;
    end if;

    select id, name, price, offer_price, offer_days
      into v_id, v_name, v_price, v_offer_price, v_offer_days
      from menu_items
      where id = (v_item->>'item_id')::uuid
        and cafe_id = v_cafe_id and available = true and archived = false;
    if v_id is null then raise exception 'item not available'; end if;

    v_unit := case
      when v_offer_price is not null and v_offer_days is not null and v_weekday = any(v_offer_days)
        then v_offer_price
      else v_price
    end;
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

    insert into order_items (order_id, menu_item_id, name, price, qty, modifiers, instructions, variant_id)
      values (v_order_id, v_id, v_name, v_unit, v_qty, v_mods, v_note, v_variant_id);

    if p_upsell_item_id is not null and v_id = p_upsell_item_id then
      v_upsell_taken := true;
      v_upsell_value := v_unit * v_qty;
    end if;
  end loop;

  select coalesce(sum(price * qty), 0) into v_subtotal
    from order_items where order_id = v_order_id;

  if p_coupon_code is not null and trim(p_coupon_code) <> '' then
    perform pg_advisory_xact_lock(hashtext('coupon:' || v_cafe_id::text || ':' || upper(trim(p_coupon_code))));
    select coalesce(array_agg(distinct mi.category_id), array[]::uuid[]) into v_cat_ids
      from order_items oi join menu_items mi on mi.id = oi.menu_item_id
      where oi.order_id = v_order_id and mi.category_id is not null;
    v_coupon := resolve_coupon_discount(v_cafe_id, p_coupon_code,
                                        greatest(0, v_subtotal - v_combo_savings), v_customer_id, v_cat_ids);
    v_coupon_disc := (v_coupon->>'discount')::integer;
  end if;

  select t.subtotal, t.discount, t.tax, t.service_charge, t.total
    into v_subtotal, v_discount, v_tax, v_svc, v_total
    from apply_order_taxes(v_order_id, v_combo_savings + v_coupon_disc) t;

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
-- Grant unchanged (text, jsonb, text, text, uuid, boolean, uuid, text, text) to anon, authenticated.

-- ── 2. online_payments: checked at Razorpay-connect time only, never again
--    at the moment a payment is actually created. app/api/payments/razorpay/
--    create-order/route.ts trusted the stale cafes.online_payments_enabled/
--    razorpay_status columns, neither of which a Feature Control override or
--    a plan downgrade ever touches — so disabling the feature for an
--    already-connected café was cosmetic; it could keep accepting real
--    charges. New function, same anon-safe shape as
--    public_cafe_ordering_enabled (no membership check — cafe_has_feature()
--    can't be used here for the same reason it couldn't there).
create or replace function cafe_payments_enabled(p_cafe_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_override boolean;
  v_plan_key text;
  v_features jsonb;
begin
  select enabled into v_override from cafe_feature_overrides
    where cafe_id = p_cafe_id and feature_key = 'online_payments';
  if v_override is not null then return v_override; end if;

  select plan into v_plan_key from cafes where id = p_cafe_id;
  select features into v_features from platform_plans where key = v_plan_key;
  if v_features is null then return false; end if;
  return coalesce((v_features ->> 'online_payments')::boolean, false);
end $$;

revoke execute on function cafe_payments_enabled(uuid) from public;
grant execute on function cafe_payments_enabled(uuid) to anon, authenticated, service_role;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_proc where proname = 'place_order') <> 1 then
    raise exception 'place_order: expected exactly one overload';
  end if;
  if (select count(*) from pg_proc where proname = 'cafe_payments_enabled') <> 1 then
    raise exception 'cafe_payments_enabled: expected exactly one overload';
  end if;
end $$;
