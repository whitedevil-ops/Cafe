-- ============================================================================
-- 0149 — POS redesign: wire table_sessions.guest_count through for real.
--
-- guest_count has existed on table_sessions since 0012 and is already
-- displayed on the Live Tables drawer, but nothing has ever set it — POS,
-- the waiter quick-add sheet, and get_or_create_session() all leave it NULL
-- forever. The POS redesign's order panel adds a real guest-count stepper
-- for dine-in orders, so this migration gives it somewhere real to land.
--
-- Scoped to touch ONLY staff_place_order, not get_or_create_session itself —
-- that function's signature (and every one of its other ~25 call sites
-- across the migration history, including place_order, the QR/customer
-- ordering engine) stays completely untouched. Instead, staff_place_order
-- sets guest_count with a plain UPDATE right after it resolves the session,
-- only when a value was actually supplied.
--
-- Adding a parameter creates a second overload, and PostgREST cannot pick
-- between them — the exact mistake that left an orphaned resolve_coupon_discount
-- overload live for years (fixed this session in 0146). staff_place_order's
-- own history already gets this right every time its arity has grown
-- (0016, 0047, 0056, 0061, 0078, 0126 each drop the old signature first);
-- this migration continues that same, already-correct pattern.
-- ============================================================================

drop function if exists staff_place_order(
  uuid, jsonb, order_type, uuid, text, text, text, text, numeric, boolean, text, uuid, text, text);

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
  p_coupon_code       text default null,
  p_spin_code         text default null,
  p_guest_count       integer default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role          member_role;
  v_max_pct       numeric;
  v_session_id    uuid;
  v_customer_id   uuid;
  v_phone         text;
  v_order_id      uuid;
  v_receipt       uuid;
  v_subtotal      integer := 0;
  v_net_subtotal  integer := 0;
  v_discount      integer := 0;
  v_disc_pct_eq   numeric;
  v_tax           integer;
  v_svc           integer;
  v_total         integer;
  v_seq           integer;
  v_day_start     timestamptz;
  v_item          jsonb;
  v_qty           integer;
  v_id            uuid;
  v_name          text;
  v_price         integer;
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
  v_settled       boolean := false;
  v_existing      record;
  v_coupon        jsonb;
  v_coupon_disc   integer := 0;
  v_cat_ids       uuid[];
  v_reward_id     uuid;
  v_reward        rewards%rowtype;
  v_account       uuid;
  v_needed        integer;
  v_balance       integer;
  v_combo_id      uuid;
  v_combo_savings integer := 0;
  v_spin          spin_results%rowtype;
  v_spin_disc     integer := 0;
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
    -- NEW (0149): the only real change in this function. get_or_create_session
    -- itself is untouched, so place_order/QR ordering and every other caller
    -- of that function are unaffected.
    if p_guest_count is not null then
      update table_sessions set guest_count = p_guest_count where id = v_session_id;
    end if;
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

    v_combo_id := nullif(v_item->>'combo_id', '')::uuid;
    if v_combo_id is not null then
      v_combo_savings := v_combo_savings + expand_combo_line(
        v_order_id, p_cafe_id, v_combo_id, coalesce(v_item->'selections', '[]'::jsonb), v_qty);
      continue;
    end if;

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

    v_reward_id := nullif(v_item->>'reward_id', '')::uuid;
    if v_reward_id is not null then
      if not cafe_has_feature(p_cafe_id, 'loyalty') then
        raise exception 'loyalty rewards are not available on this café''s plan';
      end if;
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

  select coalesce(sum(price * qty), 0) into v_subtotal
    from order_items where order_id = v_order_id;
  v_net_subtotal := greatest(0, v_subtotal - v_combo_savings);

  v_max_pct := case v_role when 'owner' then 100 when 'manager' then 15 else 5 end;

  if p_discount_type is not null and p_discount_type not in ('percent', 'flat') then
    raise exception 'invalid discount type';
  end if;

  if p_discount_type = 'percent' and p_discount_value > 0 then
    if p_discount_value > v_max_pct then
      raise exception 'your role can discount at most % percent (requested %)', v_max_pct, p_discount_value;
    end if;
    v_discount := round(v_net_subtotal * p_discount_value / 100.0);
  elsif p_discount_type = 'flat' and p_discount_value > 0 then
    v_disc_pct_eq := case when v_net_subtotal > 0 then (p_discount_value * 100.0 / v_net_subtotal) else 0 end;
    if v_disc_pct_eq > v_max_pct then
      raise exception 'your role can discount at most % percent of the subtotal', v_max_pct;
    end if;
    v_discount := round(p_discount_value);
  end if;

  if p_spin_code is not null and trim(p_spin_code) <> '' then
    v_spin := redeem_spin_prize(p_cafe_id, p_spin_code, v_order_id);

    if v_spin.kind = 'item' then
      select oi.price into v_spin_disc
        from order_items oi
       where oi.order_id = v_order_id
         and oi.menu_item_id = v_spin.menu_item_id
         and (v_spin.variant_id is null or oi.variant_id = v_spin.variant_id)
       order by oi.price desc
       limit 1;
      if v_spin_disc is null then
        raise exception 'add "%" to the bill before claiming this prize', v_spin.label;
      end if;
    elsif v_spin.kind = 'percent' then
      v_spin_disc := round(v_net_subtotal * v_spin.value / 100.0);
    elsif v_spin.kind = 'flat' then
      v_spin_disc := v_spin.value;
    end if;

    v_discount := v_discount + greatest(0, coalesce(v_spin_disc, 0));

    insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
    values (p_cafe_id, auth.uid(), 'spin.prize_claimed', 'orders', v_order_id,
            jsonb_build_object('code', upper(trim(p_spin_code)), 'label', v_spin.label,
                               'kind', v_spin.kind, 'amount', v_spin_disc));
  end if;

  if p_coupon_code is not null and trim(p_coupon_code) <> '' then
    perform pg_advisory_xact_lock(hashtext('coupon:' || p_cafe_id::text || ':' || upper(trim(p_coupon_code))));
    select coalesce(array_agg(distinct mi.category_id), array[]::uuid[]) into v_cat_ids
      from order_items oi join menu_items mi on mi.id = oi.menu_item_id
      where oi.order_id = v_order_id and mi.category_id is not null;
    v_coupon := resolve_coupon_discount(p_cafe_id, p_coupon_code, v_net_subtotal, v_customer_id, v_cat_ids);
    v_coupon_disc := (v_coupon->>'discount')::integer;
    v_discount := v_discount + v_coupon_disc;
  end if;

  if v_discount > 0 then
    insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
    values (p_cafe_id, auth.uid(), 'order.discount_applied', 'orders', v_order_id,
            jsonb_build_object('type', p_discount_type, 'requested', p_discount_value,
                                'amount', v_discount, 'role', v_role,
                                'spin_amount', nullif(v_spin_disc, 0),
                                'coupon_code', case when v_coupon is not null then v_coupon->>'code' end));
  end if;

  select t.subtotal, t.discount, t.tax, t.service_charge, t.total
    into v_subtotal, v_discount, v_tax, v_svc, v_total
    from apply_order_taxes(v_order_id, v_combo_savings + v_discount) t;

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

revoke execute on function staff_place_order(
  uuid, jsonb, order_type, uuid, text, text, text, text, numeric, boolean, text, uuid, text, text, integer)
  from public, anon;
grant execute on function staff_place_order(
  uuid, jsonb, order_type, uuid, text, text, text, text, numeric, boolean, text, uuid, text, text, integer)
  to authenticated;

do $$
declare v_count integer;
begin
  select count(*) into v_count
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'staff_place_order';

  if v_count = 0 then
    raise exception 'staff_place_order is completely gone -- this migration would have broken POS ordering entirely';
  end if;
  if v_count > 1 then
    raise exception 'expected exactly one staff_place_order after this migration, found % -- an orphaned overload is present', v_count;
  end if;
end $$;
