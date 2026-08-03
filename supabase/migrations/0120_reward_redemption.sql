-- ============================================================================
-- 0120 — Make a loyalty reward a real, orderable thing instead of a bare
-- name string, and make redemption part of the order it's attached to.
--
-- THE BUG: redeem_reward (0064) only ever debited points and returned a
-- toast — rewards has no menu_item_id, so there was never anything to add
-- to the cart/bill, and nothing was ever sent to the kitchen. On top of
-- that, points were spent the instant staff tapped "Redeem," independent of
-- whether an order was ever actually placed — an abandoned order still cost
-- the customer their points for nothing.
--
-- THE FIX: rewards now link to a real menu_item (+ variant, if that item
-- has sizes). Redeeming one in POS adds that item to the cart at ₹0 — a
-- completely normal order_items row (price integer not null has no > 0
-- check; neither the kitchen board, the KDS screen, nor the receipt
-- template do anything special with price), so it now genuinely appears on
-- the bill and goes to the kitchen like any other item.
--
-- Redemption is now validated and paid for atomically INSIDE
-- staff_place_order, mirroring exactly how coupons already work
-- (resolve_coupon_discount is called from inside staff_place_order, never
-- trusting a client-supplied discount) — a client can attach a reward_id to
-- a cart line, but the server independently re-checks the reward is real,
-- active, belongs to this café, matches the item/variant it's attached to,
-- and that the customer's real balance covers it, THEN inserts the
-- loyalty_transactions debit in the same transaction as the order. If the
-- order fails for any reason, the whole thing (including the debit) rolls
-- back — points are only ever spent alongside a real, placed order.
--
-- reward_id travels inside a p_items jsonb element, so staff_place_order's
-- own SQL signature does not change — no overload-ambiguity risk there.
-- create_reward's parameter list IS growing, so per the lesson this project
-- already learned twice (0043, 0097, noted again in 0106), it gets an
-- explicit DROP first.
--
-- Existing rewards with no linked item are left untouched in the database
-- (no destructive data mutation on a live café's config) — POS and the
-- Loyalty settings list simply stop treating them as redeemable.
-- ============================================================================

alter table rewards add column if not exists menu_item_id uuid references menu_items(id) on delete set null;
alter table rewards add column if not exists variant_id   uuid references menu_item_variants(id) on delete set null;
alter table order_items add column if not exists reward_id uuid references rewards(id) on delete set null;

-- ── create_reward: now requires a linked menu item ─────────────────────────
drop function if exists create_reward(uuid, text, integer);

create or replace function create_reward(
  p_cafe_id      uuid,
  p_name         text,
  p_points_cost  integer,
  p_menu_item_id uuid,
  p_variant_id   uuid default null
) returns rewards
language plpgsql security definer set search_path = public as $$
declare
  v_role         member_role;
  v_row          rewards%rowtype;
  v_has_variants boolean;
begin
  select role into v_role from cafe_members where cafe_id = p_cafe_id and user_id = auth.uid();
  if v_role is null then raise exception 'not authorized for this café'; end if;
  if v_role not in ('owner', 'manager') then
    raise exception 'only an owner or manager can create rewards';
  end if;

  if p_name is null or trim(p_name) = '' then raise exception 'enter a reward name'; end if;
  if p_points_cost is null or p_points_cost <= 0 then raise exception 'points cost must be greater than 0'; end if;

  if not exists (select 1 from menu_items where id = p_menu_item_id and cafe_id = p_cafe_id and archived = false) then
    raise exception 'menu item not found';
  end if;

  v_has_variants := exists (select 1 from menu_item_variants where menu_item_id = p_menu_item_id);
  if v_has_variants and p_variant_id is null then
    raise exception 'this item has sizes — pick one for the reward';
  end if;
  if p_variant_id is not null and not exists (
    select 1 from menu_item_variants where id = p_variant_id and menu_item_id = p_menu_item_id
  ) then
    raise exception 'invalid variant for this item';
  end if;

  insert into rewards (cafe_id, name, points_cost, menu_item_id, variant_id)
  values (p_cafe_id, trim(p_name), p_points_cost, p_menu_item_id, p_variant_id)
  returning * into v_row;

  return v_row;
end $$;

revoke execute on function create_reward(uuid, text, integer, uuid, uuid) from public, anon;
grant execute on function create_reward(uuid, text, integer, uuid, uuid) to authenticated;

-- ── staff_place_order: verbatim from 0106 except the item loop gains
--    reward-line handling and the insert gains reward_id. Signature
--    unchanged. ─────────────────────────────────────────────────────────────
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
  v_cat_ids      uuid[];
  v_reward_id    uuid;
  v_reward       rewards%rowtype;
  v_account      uuid;
  v_needed       integer;
  v_balance      integer;
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

    -- Reward redemption for this line — resolved BEFORE addons so a free
    -- line can never pick up chargeable addon value on top of the ₹0 price
    -- set below (addons are simply not processed for a reward line at all,
    -- regardless of what the client sends).
    v_reward_id := nullif(v_item->>'reward_id', '')::uuid;
    if v_reward_id is not null then
      select * into v_reward from rewards where id = v_reward_id and cafe_id = p_cafe_id;
      if v_reward.id is null then raise exception 'reward not found'; end if;
      if not v_reward.active then raise exception 'reward "%" is no longer available', v_reward.name; end if;
      if v_reward.menu_item_id is distinct from v_id then
        raise exception 'reward "%" does not apply to this item', v_reward.name;
      end if;
      if v_reward.variant_id is distinct from v_variant_id then
        raise exception 'reward "%" requires a different variant', v_reward.name;
      end if;
      v_unit := 0;
    end if;

    if v_reward_id is null and v_item ? 'addon_ids' then
      for v_addon in select jsonb_array_elements_text(v_item->'addon_ids') loop
        select name, price into v_aname, v_aprice
          from menu_item_addons where id = v_addon::uuid and menu_item_id = v_id;
        if v_aname is null then raise exception 'invalid add-on'; end if;
        v_unit := v_unit + v_aprice;
        v_mods := v_mods || jsonb_build_object('name', v_aname, 'price', v_aprice);
      end loop;
    end if;

    v_note := nullif(trim(coalesce(v_item->>'note', '')), '');

    insert into order_items (order_id, menu_item_id, name, price, qty, modifiers, instructions, variant_id, reward_id)
      values (v_order_id, v_id, v_name, v_unit, v_qty, v_mods, v_note, v_variant_id, v_reward_id);
    v_subtotal := v_subtotal + v_unit * v_qty;

    -- Debit points for this reward line, atomically with the order it's
    -- attached to. Same advisory-lock pattern as the loyalty double-spend
    -- fix (0071) — an earlier reward line in this SAME order is already
    -- visible to this balance read (ordinary same-transaction visibility),
    -- so two reward lines in one order correctly check against each other.
    if v_reward_id is not null then
      if v_customer_id is null then
        raise exception 'a customer phone number is required to redeem a reward';
      end if;
      v_account := get_or_create_loyalty_account(p_cafe_id, v_customer_id);
      perform pg_advisory_xact_lock(hashtext('loyalty:' || v_account::text));
      v_needed := v_reward.points_cost * v_qty;
      select coalesce(sum(points), 0) into v_balance from loyalty_transactions where account_id = v_account;
      if v_balance < v_needed then
        raise exception 'not enough points to redeem "%" — % needed, % available', v_reward.name, v_needed, v_balance;
      end if;
      insert into loyalty_transactions (cafe_id, account_id, order_id, kind, points, reason)
      values (p_cafe_id, v_account, v_order_id, 'redeem', -v_needed, 'Redeemed: ' || v_reward.name);
    end if;
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
    perform pg_advisory_xact_lock(hashtext('coupon:' || p_cafe_id::text || ':' || upper(trim(p_coupon_code))));
    select coalesce(array_agg(distinct mi.category_id), array[]::uuid[]) into v_cat_ids
      from order_items oi join menu_items mi on mi.id = oi.menu_item_id
      where oi.order_id = v_order_id and mi.category_id is not null;
    v_coupon := resolve_coupon_discount(p_cafe_id, p_coupon_code, v_subtotal, v_customer_id, v_cat_ids);
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

grant execute on function staff_place_order(uuid, jsonb, order_type, uuid, text, text, text, text, numeric, boolean, text, uuid, text) to authenticated;

-- ── get_receipt: verbatim from 0109 + one new field per item so the receipt
--    can show an unambiguous "Free (reward)" tag instead of inferring it
--    from price = 0 (which would also mislabel a menu item that's
--    genuinely configured free, e.g. a complimentary water). ───────────────
create or replace function get_receipt(p_token uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'cafe', jsonb_build_object(
      'name', c.name,
      'legal_name', c.legal_name,
      'trade_name', c.trade_name,
      'address', c.address, 'city', c.city, 'state', c.state, 'pincode', c.pincode,
      'gstin', c.gstin, 'logo_url', c.logo_url, 'phone', c.phone,
      'gst_registered', c.gst_registered,
      'tax_inclusive', c.tax_inclusive,
      'timezone', coalesce(c.timezone, 'Asia/Kolkata'),
      'google_review_url', c.google_review_url),
    'order', jsonb_build_object(
      'short_code', o.short_code, 'created_at', o.created_at, 'status', o.status,
      'order_type', o.type,
      'payment_status', o.payment_status, 'payment_method', o.payment_method,
      'subtotal', o.subtotal, 'discount', o.discount, 'tax', o.tax,
      'service_charge', o.service_charge, 'total', o.total,
      'coupon_code', o.coupon_code, 'table_label', t.label,
      'phone_masked', case when o.phone is not null then '******' || right(o.phone, 4) end),
    'gst_invoice', case when o.gst_invoice_number is not null then jsonb_build_object(
      'invoice_number',  o.gst_invoice_number,
      'issued_at',       o.gst_invoice_issued_at,
      'taxable_amount',  (select coalesce(sum(i.taxable_value), 0) from order_items i where i.order_id = o.id),
      'cgst',            o.tax / 2,
      'sgst',            o.tax - (o.tax / 2),
      'place_of_supply', coalesce(c.state, '') ||
                         case when c.state_code is not null then ' (' || c.state_code || ')' else '' end
    ) else null end,
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'name', i.name, 'qty', i.qty, 'price', i.price, 'modifiers', i.modifiers,
        'hsn_sac', i.hsn_sac, 'tax_percent', i.tax_percent,
        'taxable_value', i.taxable_value, 'tax_amount', i.tax_amount,
        'is_reward', i.reward_id is not null) order by i.name), '[]'::jsonb)
      from order_items i where i.order_id = o.id)
  )
  from orders o
  join cafes c on c.id = o.cafe_id
  left join cafe_tables t on t.id = o.table_id
  where o.receipt_token = p_token;
$$;

grant execute on function get_receipt(uuid) to anon, authenticated;
