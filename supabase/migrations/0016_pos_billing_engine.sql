-- ============================================================================
-- 0016 — Counter POS billing engine: one canonical calculation shared by the
-- QR flow and the Counter POS flow, order source tagging, role-capped
-- discounts enforced server-side, held/resumed orders, customer lookup, and
-- audit logging for the actions that didn't have it yet.
--
-- Explicit non-goal (do not build here — no existing flow does this yet, so
-- adding it now would be a second, disconnected feature, not billing):
-- order cancellation UI and post-placement item removal. The audit trigger
-- for cancellation is added below so that whenever that feature is built, it
-- is audited from day one — but no button exists for it in this migration.
-- ============================================================================

-- ── Order source: only the source should differ between QR / POS / staff ────
do $$ begin
  create type order_source as enum ('qr', 'pos', 'staff');
exception when duplicate_object then null; end $$;

alter table orders add column if not exists source order_source not null default 'qr';

-- ── compute_bill: the one place discount → tax → service charge → total is
--    computed. Both place_order (QR) and staff_place_order (POS) call this
--    instead of each doing their own arithmetic, so the two can never drift.
create or replace function compute_bill(p_cafe_id uuid, p_subtotal integer, p_discount integer default 0)
returns table(discounted_subtotal integer, tax integer, service_charge integer, total integer)
language plpgsql stable as $$
declare
  v_tax_pct numeric;
  v_svc_pct numeric;
  v_disc    integer;
  v_base    integer;
  v_tax     integer;
  v_svc     integer;
begin
  select tax_percent, service_charge into v_tax_pct, v_svc_pct from cafes where id = p_cafe_id;
  v_disc := least(greatest(coalesce(p_discount, 0), 0), p_subtotal);
  v_base := p_subtotal - v_disc;
  v_tax  := round(v_base * coalesce(v_tax_pct, 0) / 100.0);
  v_svc  := round(v_base * coalesce(v_svc_pct, 0) / 100.0);
  return query select v_base, v_tax, v_svc, v_base + v_tax + v_svc;
end $$;

revoke execute on function compute_bill(uuid, integer, integer) from public, anon;
grant execute on function compute_bill(uuid, integer, integer) to authenticated;

-- ── held_orders: a bookmarked cart, not a real order — never counted as
--    revenue, never touched by KDS/Live Tables/reports. Cart contents are
--    re-validated for price/availability the moment they're actually placed
--    via staff_place_order, same as any other order. ───────────────────────
create table if not exists held_orders (
  id             uuid primary key default gen_random_uuid(),
  cafe_id        uuid not null references cafes(id) on delete cascade,
  staff_id       uuid references profiles(id) on delete set null,
  order_type     order_type not null default 'dine_in',
  table_id       uuid references cafe_tables(id) on delete set null,
  customer_phone text,
  customer_name  text,
  label          text,
  cart           jsonb not null,
  created_at     timestamptz not null default now()
);
create index if not exists held_orders_cafe_idx on held_orders (cafe_id, created_at desc);

alter table held_orders enable row level security;
drop policy if exists "member all" on held_orders;
create policy "member all" on held_orders for all
  using (is_cafe_member(cafe_id)) with check (is_cafe_member(cafe_id));

-- ── pos_lookup_customer: name + visit count + loyalty points for a phone
--    number, so the cashier can show "Rahul Sharma · 12 Visits · 420 Points"
--    before placing the order. Staff-only — reveals customer history. ──────
create or replace function pos_lookup_customer(p_cafe_id uuid, p_phone text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_phone   text;
  v_id      uuid;
  v_name    text;
  v_visits  integer;
  v_points  integer;
begin
  if not is_cafe_member(p_cafe_id) then
    raise exception 'not authorized for this café';
  end if;
  v_phone := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
  if v_phone is null then return jsonb_build_object('found', false); end if;

  select id, name into v_id, v_name from customers where cafe_id = p_cafe_id and phone = v_phone;
  if v_id is null then return jsonb_build_object('found', false); end if;

  select count(*) into v_visits from orders where customer_id = v_id and status <> 'cancelled';
  select coalesce(sum(b.balance), 0) into v_points
    from v_loyalty_balance b
    join loyalty_accounts a on a.id = b.account_id
    where a.customer_id = v_id and a.cafe_id = p_cafe_id;

  return jsonb_build_object('found', true, 'name', v_name, 'visits', v_visits, 'points', v_points);
end $$;

revoke execute on function pos_lookup_customer(uuid, text) from public, anon;
grant execute on function pos_lookup_customer(uuid, text) to authenticated;

-- ── payment.recorded audit — one trigger catches every payment insert
--    (POS, Kitchen, Live Tables split-bill) instead of each call site
--    remembering to log it separately. ──────────────────────────────────────
create or replace function audit_payment_recorded() returns trigger
language plpgsql as $$
begin
  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (new.cafe_id, auth.uid(), 'payment.recorded', 'payments', new.id,
          jsonb_build_object('amount', new.amount, 'method', new.method,
                              'order_id', new.order_id, 'session_id', new.session_id));
  return new;
end $$;

drop trigger if exists trg_payments_audit on payments;
create trigger trg_payments_audit after insert on payments
  for each row execute function audit_payment_recorded();

-- ── order.cancelled audit — dormant until a cancel-order action exists, but
--    ready the moment it does. ──────────────────────────────────────────────
create or replace function audit_order_cancelled() returns trigger
language plpgsql as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
    values (new.cafe_id, auth.uid(), 'order.cancelled', 'orders', new.id,
            jsonb_build_object('short_code', new.short_code, 'total', new.total));
  end if;
  return new;
end $$;

drop trigger if exists trg_orders_cancelled_audit on orders;
create trigger trg_orders_cancelled_audit after update on orders
  for each row execute function audit_order_cancelled();

-- ── place_order v7: same customer QR flow, now taxed/service-charged through
--    the same compute_bill the POS uses (previously QR bills silently
--    excluded tax/service charge that POS bills already applied to the same
--    menu — real inconsistency, now fixed), and tagged source = 'qr'. ──────
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

    insert into order_items (order_id, menu_item_id, name, price, qty, modifiers)
      values (v_order_id, v_id, v_name, v_unit, v_qty, v_mods);
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

-- ── staff_place_order v3: discounts (role-capped, enforced here — not just
--    the client), a customer name alongside the phone, per-item notes, and
--    tagged source = 'pos'. Signature changed (new trailing params), so the
--    old 6-arg overload is dropped first to avoid leaving a stale, differently
--    -permissioned copy behind. ──────────────────────────────────────────────
drop function if exists staff_place_order(uuid, jsonb, order_type, uuid, text, text);

create or replace function staff_place_order(
  p_cafe_id        uuid,
  p_items          jsonb,           -- [{item_id, qty, variant_id?, addon_ids?, note?}]
  p_order_type     order_type default 'dine_in',
  p_table_id       uuid default null,
  p_payment_method text default 'counter',
  p_customer_phone text default null,
  p_customer_name  text default null,
  p_discount_type  text default null,   -- 'percent' | 'flat'
  p_discount_value numeric default 0
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
  v_base         integer;
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
begin
  select role into v_role from cafe_members where cafe_id = p_cafe_id and user_id = auth.uid();
  if v_role is null then
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
    insert into customers (cafe_id, phone, name, last_seen)
    values (p_cafe_id, v_phone, nullif(trim(coalesce(p_customer_name, '')), ''), now())
    on conflict (cafe_id, phone) do update
      set last_seen = now(),
          name = coalesce(nullif(trim(coalesce(p_customer_name, '')), ''), customers.name)
    returning id into v_customer_id;
  end if;

  v_day_start := (date_trunc('day', (now() at time zone 'Asia/Kolkata')) at time zone 'Asia/Kolkata');
  select count(*) + 1 into v_seq from orders
    where cafe_id = p_cafe_id and status <> 'cancelled' and created_at >= v_day_start;

  insert into orders (cafe_id, table_id, session_id, customer_id, short_code, type, status,
                      payment_status, phone, payment_method, staff_id, subtotal, total, source)
    values (p_cafe_id, p_table_id, v_session_id, v_customer_id, v_seq::text, p_order_type, 'placed',
            'unpaid', v_phone, p_payment_method::payment_method, auth.uid(), 0, 0, 'pos')
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

  -- Discount: role-capped, rejected outright (not silently clamped) so staff
  -- get a clear "you can't do that" instead of a quietly-reduced discount.
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

  select * into v_base, v_tax, v_svc, v_total from compute_bill(p_cafe_id, v_subtotal, v_discount);

  update orders set subtotal = v_subtotal, discount = v_subtotal - v_base,
                    tax = v_tax, service_charge = v_svc, total = v_total
    where id = v_order_id;

  if v_subtotal - v_base > 0 then
    insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
    values (p_cafe_id, auth.uid(), 'order.discount_applied', 'orders', v_order_id,
            jsonb_build_object('type', p_discount_type, 'requested', p_discount_value,
                                'amount', v_subtotal - v_base, 'role', v_role));
  end if;

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (p_cafe_id, auth.uid(), 'order.created', 'orders', v_order_id,
          jsonb_build_object('source', 'pos', 'total', v_total, 'order_type', p_order_type, 'table_id', p_table_id));

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
                            'subtotal', v_subtotal, 'discount', v_subtotal - v_base,
                            'tax', v_tax, 'service_charge', v_svc,
                            'total', v_total, 'receipt_token', v_receipt);
end $$;

revoke execute on function staff_place_order(uuid, jsonb, order_type, uuid, text, text, text, text, numeric) from public, anon;
grant execute on function staff_place_order(uuid, jsonb, order_type, uuid, text, text, text, text, numeric) to authenticated;
