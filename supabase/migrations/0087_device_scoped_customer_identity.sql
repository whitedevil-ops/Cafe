-- ============================================================================
-- 0087 — Customer identity vs. table session are now properly separate, and
-- customer-facing order history is scoped to the DEVICE that placed each
-- order, not to the phone-matched customer record.
--
-- THE GAP THIS CLOSES: customer_start_session (0081/0082) upserts `customers`
-- by (cafe_id, phone) with no verification at all, and customer_order_history
-- (0023) scoped its results to that resolved customer_id. Combined, ANY
-- device that types a phone number already on file gets a session pointing
-- at that person's real customer_id — and with it, their full order history
-- at this café. Typing a 10-digit number was proving nothing, exactly the
-- threat model 0023's own original comment warned about, before 0081 traded
-- it away for OTP-free ordering.
--
-- FIX (chosen explicitly over restoring OTP): identity access is now scoped
-- by DEVICE, not by phone match. A device_id is generated client-side once
-- per browser (lib/customer-session.ts), sent alongside both
-- customer_start_session and place_order, and stored on customer_sessions
-- and orders respectively. customer_order_history and
-- customer_reorder_payload now filter by device_id instead of customer_id —
-- so a different device typing the same phone number starts a brand-new,
-- empty-history device scope, even though it upserts the SAME underlying
-- `customers` row (that upsert is untouched and still correct: it's what
-- feeds v_customer_stats/loyalty/segments, which are staff-facing, RLS-
-- protected, and were never the vulnerability here).
--
-- KNOWN, DELIBERATE SIDE EFFECT: orders placed before this migration have no
-- device_id and will no longer appear in ANY device's "My Orders" going
-- forward — there is no way to retroactively know which device placed them.
-- New orders are unaffected; only the historical backlog stops surfacing.
--
-- Table/session scoping (0081's per-table-token localStorage key) is also
-- widened to per-café in the client, so a returning customer on the SAME
-- device is recognized across DIFFERENT tables at the same café without
-- re-entering their name/phone — see lib/customer-session.ts.
-- ============================================================================

alter table customer_sessions add column if not exists device_id text;
alter table orders            add column if not exists device_id text;

-- ── Resolve a session token to (customer, café, device) ────────────────────
drop function if exists customer_session_identity(text);
create function customer_session_identity(p_session_token text)
returns table (customer_id uuid, cafe_id uuid, device_id text)
language plpgsql stable security definer set search_path = public, extensions as $$
declare v_hash text;
begin
  if p_session_token is null or length(p_session_token) < 32 then return; end if;
  v_hash := encode(digest(p_session_token, 'sha256'), 'hex');

  return query
  select s.customer_id, s.cafe_id, s.device_id
  from customer_sessions s
  where s.token_hash = v_hash
    and s.revoked_at is null
    and s.expires_at > now();
end $$;

revoke execute on function customer_session_identity(text) from public, anon, authenticated;

-- ── customer_start_session: now captures device_id ──────────────────────────
drop function if exists customer_start_session(text, text, text);
create function customer_start_session(p_table_token text, p_phone text, p_name text, p_device_id text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_cafe_id     uuid;
  v_status      text;
  v_phone       text;
  v_name        text;
  v_customer_id uuid;
  v_recent      integer;
  v_token       text;
begin
  select t.cafe_id into v_cafe_id from cafe_tables t where t.token = p_table_token;
  if v_cafe_id is null then raise exception 'invalid table'; end if;

  select status into v_status from cafes where id = v_cafe_id;
  if v_status <> 'active' then raise exception 'this café is not currently active'; end if;

  v_phone := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
  if v_phone is null or v_phone !~ '^[6-9][0-9]{9}$' then raise exception 'invalid phone number'; end if;

  v_name := nullif(trim(coalesce(p_name, '')), '');
  if v_name is null then raise exception 'name is required'; end if;

  select count(*) into v_recent from customer_sessions s
    join customers c on c.id = s.customer_id
    where c.cafe_id = v_cafe_id and c.phone = v_phone and s.created_at > now() - interval '1 hour';
  if v_recent >= 5 then
    raise exception 'too many attempts for this number — please try again in a while';
  end if;

  -- Dedup by (cafe_id, phone) is deliberately unchanged — this is the CRM
  -- identity (v_customer_stats, loyalty, segments), a staff-facing,
  -- RLS-protected surface. It is not what grants customer-facing history
  -- access; device_id below is.
  insert into customers (cafe_id, phone, name, last_seen)
  values (v_cafe_id, v_phone, v_name, now())
  on conflict (cafe_id, phone) do update set name = v_name, last_seen = now()
  returning id into v_customer_id;

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into customer_sessions (cafe_id, customer_id, token_hash, expires_at, device_id)
  values (v_cafe_id, v_customer_id, encode(digest(v_token, 'sha256'), 'hex'), now() + interval '90 days',
          nullif(trim(coalesce(p_device_id, '')), ''));

  return jsonb_build_object('ok', true, 'session_token', v_token, 'customer_id', v_customer_id, 'name', v_name, 'phone', v_phone);
end $$;

revoke execute on function customer_start_session(text, text, text, text) from public, anon;
grant execute on function customer_start_session(text, text, text, text) to anon, authenticated;

-- ── place_order: now stamps device_id on the order it creates ───────────────
-- Body is otherwise byte-identical to 0078's version — coupon/tax/upsell/GST
-- logic untouched. p_device_id is appended, not inserted mid-list, so this
-- stays additive over 0078's positional callers (there are none — the app
-- calls this via named RPC params).
drop function if exists place_order(text, jsonb, text, text, uuid, boolean, uuid, text);
create function place_order(
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
  v_cat_ids      uuid[];
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
                      phone, payment_method, subtotal, total, upsell_shown, source, client_request_id, device_id)
    values (v_cafe_id, v_table_id, v_session_id, v_customer_id, v_seq::text, 'dine_in', 'placed', 'unpaid',
            v_phone, p_payment_method::payment_method, 0, 0, coalesce(p_upsell_shown, false), 'qr', p_client_request_id,
            nullif(trim(coalesce(p_device_id, '')), ''))
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
    select coalesce(array_agg(distinct mi.category_id), array[]::uuid[]) into v_cat_ids
      from order_items oi join menu_items mi on mi.id = oi.menu_item_id
      where oi.order_id = v_order_id and mi.category_id is not null;
    v_coupon := resolve_coupon_discount(v_cafe_id, p_coupon_code, v_subtotal, v_customer_id, v_cat_ids);
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

grant execute on function place_order(text, jsonb, text, text, uuid, boolean, uuid, text, text) to anon, authenticated;

-- ── customer_order_history: scoped by device, not customer_id ───────────────
-- Same signature/return shape as 0023 — only the WHERE clause changes, from
-- "everything this customer_id ever ordered" to "everything placed from
-- this exact device". A session with no device_id (shouldn't happen for any
-- session minted after this migration) matches nothing, same as an expired
-- token — fails closed, never open.
create or replace function customer_order_history(
  p_session_token text, p_limit integer default 10, p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_customer_id uuid;
  v_cafe_id     uuid;
  v_device_id   text;
  v_limit       integer := least(greatest(coalesce(p_limit, 10), 1), 50);
  v_total       integer;
begin
  select i.customer_id, i.cafe_id, i.device_id into v_customer_id, v_cafe_id, v_device_id
    from customer_session_identity(p_session_token) i;
  if v_customer_id is null then raise exception 'session expired — please verify your number again'; end if;

  select count(*) into v_total from orders o
    where o.device_id = v_device_id and o.cafe_id = v_cafe_id and o.status <> 'cancelled';

  return jsonb_build_object(
    'total', v_total,
    'limit', v_limit,
    'offset', greatest(coalesce(p_offset, 0), 0),
    'cafe_name', (select c.name from cafes c where c.id = v_cafe_id),
    'orders', coalesce((
      select jsonb_agg(row_to_json(x) order by x.created_at desc) from (
        select
          o.id, o.short_code, o.status, o.payment_status, o.payment_method,
          o.subtotal, o.discount, o.tax, o.service_charge, o.total,
          o.created_at, o.receipt_token, o.type,
          (select t.label from cafe_tables t where t.id = o.table_id) as table_label,
          (select coalesce(jsonb_agg(jsonb_build_object(
             'name', oi.name, 'qty', oi.qty, 'price', oi.price, 'modifiers', oi.modifiers
           ) order by oi.id), '[]'::jsonb)
           from order_items oi where oi.order_id = o.id) as items
        from orders o
        where o.device_id = v_device_id and o.cafe_id = v_cafe_id and o.status <> 'cancelled'
        order by o.created_at desc
        limit v_limit offset greatest(coalesce(p_offset, 0), 0)
      ) x
    ), '[]'::jsonb)
  );
end $$;

-- ── customer_reorder_payload: ownership check by device, not customer_id ────
create or replace function customer_reorder_payload(p_session_token text, p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_customer_id uuid;
  v_cafe_id     uuid;
  v_device_id   text;
  v_owner       text;
begin
  select i.customer_id, i.cafe_id, i.device_id into v_customer_id, v_cafe_id, v_device_id
    from customer_session_identity(p_session_token) i;
  if v_customer_id is null then raise exception 'session expired — please verify your number again'; end if;

  select o.device_id into v_owner from orders o
    where o.id = p_order_id and o.cafe_id = v_cafe_id;
  if v_owner is null or v_owner <> v_device_id then raise exception 'order not found'; end if;

  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'item_id',    mi.id,
        'name',       mi.name,
        'qty',        oi.qty,
        'available',  (mi.available and not mi.archived),
        'variant_id', (
          select v.id from menu_item_variants v
          where v.menu_item_id = mi.id
            and v.name in (select jsonb_array_elements(oi.modifiers) ->> 'name')
          limit 1
        ),
        'addon_ids', coalesce((
          select jsonb_agg(a.id) from menu_item_addons a
          where a.menu_item_id = mi.id
            and a.name in (select jsonb_array_elements(oi.modifiers) ->> 'name')
        ), '[]'::jsonb)
      ) order by oi.id)
      from order_items oi
      join menu_items mi on mi.id = oi.menu_item_id
      where oi.order_id = p_order_id
    ), '[]'::jsonb),
    'unavailable', coalesce((
      select jsonb_agg(oi.name order by oi.id)
      from order_items oi
      left join menu_items mi on mi.id = oi.menu_item_id
      where oi.order_id = p_order_id
        and (mi.id is null or mi.available = false or mi.archived = true)
    ), '[]'::jsonb)
  );
end $$;
