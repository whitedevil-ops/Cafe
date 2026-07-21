-- ============================================================================
-- 0010 — Secure receipts, SMS architecture, customer linking. Idempotent.
--
--  * orders.receipt_token: unguessable public token for the digital bill page
--    (/r/{token}) — never expose sequential ids publicly.
--  * sms_logs: delivery tracking. Full phone numbers are NOT stored here (only
--    a masked tail); the sender reads orders.phone server-side at send time.
--  * place_order v4: validates Indian mobile format server-side and links the
--    order to the café's customer record by (cafe_id, phone) — creating one on
--    first visit, updating last_seen on return visits.
--  * get_receipt(token): SECURITY DEFINER read for the public bill page —
--    returns exactly the bill fields, nothing else, only for a valid token.
--  * enqueue_bill_sms trigger: on completion, queue an SMS row. SMS never
--    blocks order completion; failures are recorded, retryable by staff.
-- ============================================================================

alter table orders add column if not exists receipt_token uuid not null default gen_random_uuid();
create unique index if not exists orders_receipt_token_key on orders (receipt_token);

create table if not exists sms_logs (
  id           uuid primary key default gen_random_uuid(),
  cafe_id      uuid not null references cafes(id) on delete cascade,
  order_id     uuid not null references orders(id) on delete cascade,
  customer_id  uuid references customers(id) on delete set null,
  phone_masked text,
  type         text not null default 'bill',
  provider     text not null default 'none',
  status       text not null default 'pending',   -- pending | sent | delivered | failed | skipped
  error        text,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  failed_at    timestamptz
);
create index if not exists sms_logs_cafe_idx on sms_logs (cafe_id, created_at desc);
create index if not exists sms_logs_order_idx on sms_logs (order_id);

alter table sms_logs enable row level security;
drop policy if exists "member all" on sms_logs;
create policy "member all" on sms_logs for all
  using (is_cafe_member(cafe_id)) with check (is_cafe_member(cafe_id));

-- ── place_order v4: phone validation + customer upsert/link ────────────────
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
  v_customer_id  uuid;
  v_phone        text;
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
  if p_payment_method not in ('counter','cash','card') then
    raise exception 'invalid payment method';
  end if;

  -- Server-side phone validation (never trust the client). Indian mobile:
  -- 10 digits starting 6-9. Empty is allowed only as explicit null.
  v_phone := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
  if v_phone is not null and v_phone !~ '^[6-9][0-9]{9}$' then
    raise exception 'invalid phone number';
  end if;

  select id, cafe_id into v_table_id, v_cafe_id from cafe_tables where token = p_token;
  if v_cafe_id is null then raise exception 'invalid table'; end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'empty order';
  end if;

  -- Returning customer? Link by (cafe_id, phone); create on first visit.
  if v_phone is not null then
    insert into customers (cafe_id, phone, last_seen)
    values (v_cafe_id, v_phone, now())
    on conflict (cafe_id, phone) do update set last_seen = now()
    returning id into v_customer_id;
  end if;

  v_day_start := (date_trunc('day', (now() at time zone 'Asia/Kolkata')) at time zone 'Asia/Kolkata');
  select count(*) + 1 into v_seq from orders
    where cafe_id = v_cafe_id and status <> 'cancelled' and created_at >= v_day_start;

  insert into orders (cafe_id, table_id, customer_id, short_code, type, status, payment_status,
                      phone, payment_method, subtotal, total, upsell_shown)
    values (v_cafe_id, v_table_id, v_customer_id, v_seq::text, 'dine_in', 'placed', 'unpaid',
            v_phone, p_payment_method::payment_method, 0, 0, coalesce(p_upsell_shown, false))
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

-- ── Public receipt: token-scoped, fields-scoped, definer read ───────────────
create or replace function get_receipt(p_token uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'cafe', jsonb_build_object(
      'name', c.name, 'address', c.address, 'city', c.city,
      'gstin', c.gstin, 'logo_url', c.logo_url, 'phone', c.phone),
    'order', jsonb_build_object(
      'short_code', o.short_code, 'created_at', o.created_at, 'status', o.status,
      'payment_status', o.payment_status, 'payment_method', o.payment_method,
      'subtotal', o.subtotal, 'discount', o.discount, 'tax', o.tax,
      'service_charge', o.service_charge, 'total', o.total,
      'coupon_code', o.coupon_code, 'table_label', t.label,
      'phone_masked', case when o.phone is not null then '******' || right(o.phone, 4) end),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'name', i.name, 'qty', i.qty, 'price', i.price, 'modifiers', i.modifiers)), '[]'::jsonb)
      from order_items i where i.order_id = o.id)
  )
  from orders o
  join cafes c on c.id = o.cafe_id
  left join cafe_tables t on t.id = o.table_id
  where o.receipt_token = p_token;
$$;

grant execute on function get_receipt(uuid) to anon, authenticated;

-- ── SMS queue: enqueue on completion, never block the order ─────────────────
create or replace function enqueue_bill_sms()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' and new.phone is not null then
    insert into sms_logs (cafe_id, order_id, customer_id, phone_masked, type, provider, status)
    values (new.cafe_id, new.id, new.customer_id, '******' || right(new.phone, 4), 'bill', 'none', 'pending');
  end if;
  return new;
end $$;

drop trigger if exists on_order_completed_sms on orders;
create trigger on_order_completed_sms
  after update of status on orders for each row execute function enqueue_bill_sms();
