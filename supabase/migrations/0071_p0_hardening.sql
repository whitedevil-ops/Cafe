-- ============================================================================
-- 0071 — P0 hardening pass, found by a full-repo audit (2026-07-25):
--
-- 1. `customers` was never included in 0050's financial lockdown — any staff
--    role (kitchen, waiter) could read/write/delete the whole customer
--    database directly via REST. Same fix as 0050, same table shape: every
--    write already goes through SECURITY DEFINER order-engine functions
--    (place_order, staff_place_order, redeem_reward, ...), which run as the
--    function owner and are unaffected by revoking direct grants — confirmed
--    by grep, there is no client-side `.from('customers').insert/update(...)`
--    anywhere in the app.
--
-- 2. `cafe_settings` has the same gap — any staff member could rewrite a
--    café's hours/receipt footer directly via REST, even though the Save
--    button is UI-gated to owner/manager. One real client write path exists
--    (app/dashboard/profile/profile-client.tsx), replaced here with an RPC.
--
-- 3. Loyalty redemption (`redeem_reward`) read the account balance with a
--    plain SELECT and no lock — two concurrent redemptions for the same
--    account could both pass the balance check and double-spend points.
--    Fixed with a transaction-scoped advisory lock keyed on the account id.
--
-- 4. Coupon redemption had the identical race: `resolve_coupon_discount`'s
--    usage_limit/per_customer checks are plain `count(*)` reads with no lock,
--    called from `place_order`/`staff_place_order` right before the
--    `coupon_redemptions` insert. The function itself stays `stable` (it is
--    also used for side-effect-free previews via validate_coupon/
--    validate_coupon_public), so the lock is taken at the two REAL call
--    sites instead, keyed on (cafe_id, upper(code)) — concurrent orders
--    redeeming the same coupon for the same café now serialize.
--
-- 5. `reverse_stock_for_cancelled_order` (0060) recomputed the quantity to
--    restore by re-joining order_items to the CURRENT recipe_items — if a
--    recipe was edited between placement and cancellation, the reversal
--    restores a different quantity than what was actually deducted, silently
--    corrupting stock. Fixed by making inventory_transactions the source of
--    truth for what a given order_item actually deducted (a new
--    order_item_id column), and reversing exactly those ledger rows instead
--    of recomputing from today's recipe.
-- ============================================================================

-- ── 1. customers: read-only to members, all writes via existing RPCs ───────
drop policy if exists "member all" on customers;
create policy "member read" on customers
  for select using (is_cafe_member(cafe_id));
revoke insert, update, delete on customers from authenticated, anon;

-- ── 2. cafe_settings: read-only to members, writes via a new RPC ───────────
drop policy if exists "member all" on cafe_settings;
create policy "member read" on cafe_settings
  for select using (is_cafe_member(cafe_id));
revoke insert, update, delete on cafe_settings from authenticated, anon;

create or replace function update_cafe_settings(
  p_cafe_id uuid,
  p_hours   jsonb,
  p_receipt jsonb
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_cafe_role(p_cafe_id, array['owner','manager']::member_role[]) then
    raise exception 'only an owner or manager can change café settings';
  end if;

  insert into cafe_settings (cafe_id, hours, receipt, updated_at)
  values (p_cafe_id, coalesce(p_hours, '{}'::jsonb), coalesce(p_receipt, '{}'::jsonb), now())
  on conflict (cafe_id) do update
    set hours = coalesce(p_hours, '{}'::jsonb),
        receipt = coalesce(p_receipt, '{}'::jsonb),
        updated_at = now();
end $$;

revoke execute on function update_cafe_settings(uuid, jsonb, jsonb) from public, anon;
grant execute on function update_cafe_settings(uuid, jsonb, jsonb) to authenticated;

-- ── 3. Loyalty redemption: serialize by account ─────────────────────────────
create or replace function redeem_reward(
  p_cafe_id        uuid,
  p_customer_phone text,
  p_reward_id      uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_phone       text;
  v_customer_id uuid;
  v_customer_name text;
  v_account     uuid;
  v_balance     integer;
  v_reward      rewards%rowtype;
begin
  if not is_cafe_member(p_cafe_id) then
    raise exception 'not authorized for this café';
  end if;

  v_phone := nullif(regexp_replace(coalesce(p_customer_phone, ''), '\D', '', 'g'), '');
  if v_phone is null then raise exception 'a customer phone number is required'; end if;

  select id, name into v_customer_id, v_customer_name
    from customers where cafe_id = p_cafe_id and phone = v_phone;
  if v_customer_id is null then raise exception 'no customer found with this phone number'; end if;

  select * into v_reward from rewards where id = p_reward_id and cafe_id = p_cafe_id;
  if v_reward.id is null then raise exception 'reward not found'; end if;
  if not v_reward.active then raise exception 'this reward is no longer available'; end if;

  v_account := get_or_create_loyalty_account(p_cafe_id, v_customer_id);

  -- Serializes concurrent redemptions for the SAME account — the second
  -- caller blocks here until the first transaction commits, then reads the
  -- now-updated balance. Auto-released at transaction end, no cleanup needed.
  perform pg_advisory_xact_lock(hashtext('loyalty:' || v_account::text));

  select coalesce(sum(points), 0) into v_balance from loyalty_transactions where account_id = v_account;
  if v_balance < v_reward.points_cost then
    raise exception '% has % points — this reward needs %',
      coalesce(v_customer_name, 'this customer'), v_balance, v_reward.points_cost;
  end if;

  insert into loyalty_transactions (cafe_id, account_id, order_id, kind, points, reason)
  values (p_cafe_id, v_account, null, 'redeem', -v_reward.points_cost, 'Redeemed: ' || v_reward.name);

  return jsonb_build_object(
    'reward', v_reward.name, 'points_spent', v_reward.points_cost,
    'remaining_balance', v_balance - v_reward.points_cost);
end $$;

revoke execute on function redeem_reward(uuid, text, uuid) from public, anon;
grant execute on function redeem_reward(uuid, text, uuid) to authenticated;

-- ── 4. Coupon redemption: serialize by (cafe, code) at the real call sites ─
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
    perform pg_advisory_xact_lock(hashtext('coupon:' || v_cafe_id::text || ':' || upper(trim(p_coupon_code))));
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
    perform pg_advisory_xact_lock(hashtext('coupon:' || p_cafe_id::text || ':' || upper(trim(p_coupon_code))));
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

-- ── 5. Inventory reversal: reverse the actual ledger, not a recomputation ──
alter table inventory_transactions add column if not exists order_item_id uuid references order_items(id) on delete set null;
create index if not exists inventory_transactions_order_item_idx on inventory_transactions (order_item_id) where order_item_id is not null;

create or replace function deduct_stock_for_order_item() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id uuid;
  v_enabled boolean;
  v_r       record;
begin
  begin
    select o.cafe_id into v_cafe_id from orders o where o.id = new.order_id;
    if v_cafe_id is null then return new; end if;

    select auto_deduct_stock into v_enabled from cafes where id = v_cafe_id;
    if not coalesce(v_enabled, false) then return new; end if;
    if new.menu_item_id is null then return new; end if;

    for v_r in
      select ri.inventory_item_id, ri.qty
      from recipe_items ri
      where ri.menu_item_id = new.menu_item_id and ri.cafe_id = v_cafe_id
    loop
      update inventory_items
        set current_stock = current_stock - (v_r.qty * new.qty)
        where id = v_r.inventory_item_id and cafe_id = v_cafe_id;

      -- order_item_id makes this row the source of truth for what THIS
      -- order line actually deducted, so a later reversal can read it back
      -- exactly rather than recomputing against whatever the recipe says today.
      insert into inventory_transactions (cafe_id, item_id, delta, reason, order_item_id)
      values (v_cafe_id, v_r.inventory_item_id, -(v_r.qty * new.qty),
              'Auto: order item ' || new.name, new.id);
    end loop;
  exception when others then
    -- Swallowed on purpose. Stock accounting is never allowed to break an order.
    null;
  end;
  return new;
end $$;

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

    -- Reverses exactly what deduct_stock_for_order_item actually deducted for
    -- this order (read from the ledger via order_item_id), not what today's
    -- recipe_items would deduct — safe even if the recipe changed since.
    for v_r in
      select it.item_id as inventory_item_id, sum(-it.delta) as total_qty
        from inventory_transactions it
        join order_items oi on oi.id = it.order_item_id
       where oi.order_id = p_order_id and it.order_item_id is not null
       group by it.item_id
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

revoke execute on function reverse_stock_for_cancelled_order(uuid) from public, anon, authenticated;
