-- ============================================================================
-- 0012 — Phase 1: real table-session architecture, Request Bill, Call Waiter,
-- Move Table, Notification Center, and split-bill payment support.
-- Idempotent and non-destructive: no existing table/column is dropped, no
-- historical order/payment loses its order_id linkage.
--
-- WHY table_sessions: today "occupied" is inferred from "any order with this
-- table_id whose status isn't completed/cancelled" — which works for a single
-- order but has no home for session-level concepts (guest count, move table,
-- split bill, request-bill/call-waiter state, a session close timestamp).
-- One dining visit = one session; every order placed during that visit
-- attaches to it via orders.session_id. Nothing about the existing orders
-- table changes shape — this is purely additive.
-- ============================================================================

create type session_status as enum ('active', 'bill_requested', 'closed');

create table if not exists table_sessions (
  id           uuid primary key default gen_random_uuid(),
  cafe_id      uuid not null references cafes(id) on delete cascade,
  table_id     uuid not null references cafe_tables(id) on delete cascade,
  status       session_status not null default 'active',
  guest_count  integer,
  started_at   timestamptz not null default now(),
  closed_at    timestamptz,
  closed_by    uuid references profiles(id) on delete set null
);
create index if not exists table_sessions_cafe_idx on table_sessions (cafe_id, status);
create index if not exists table_sessions_table_idx on table_sessions (table_id, status);

alter table orders add column if not exists session_id uuid references table_sessions(id) on delete set null;
create index if not exists orders_session_idx on orders (session_id);

alter table table_sessions enable row level security;
drop policy if exists "member all" on table_sessions;
create policy "member all" on table_sessions for all
  using (is_cafe_member(cafe_id)) with check (is_cafe_member(cafe_id));

-- ── Notification Center ──────────────────────────────────────────────────────
create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  cafe_id    uuid not null references cafes(id) on delete cascade,
  type       text not null,             -- new_order | bill_requested | call_waiter | sms_failed | low_stock ...
  message    text not null,
  table_id   uuid references cafe_tables(id) on delete set null,
  session_id uuid references table_sessions(id) on delete set null,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_cafe_idx on notifications (cafe_id, read, created_at desc);

alter table notifications enable row level security;
drop policy if exists "member all" on notifications;
create policy "member all" on notifications for all
  using (is_cafe_member(cafe_id)) with check (is_cafe_member(cafe_id));

-- ── Split-bill payments: a split can be session-level (not one order) ───────
alter table payments alter column order_id drop not null;
alter table payments add column if not exists session_id uuid references table_sessions(id) on delete cascade;
alter table payments add column if not exists split_label text;
alter table payments drop constraint if exists payments_order_or_session_chk;
alter table payments add constraint payments_order_or_session_chk
  check (order_id is not null or session_id is not null);

-- ── get_or_create_session: called by place_order so every order lands in the
--    right session instead of creating orphaned/duplicate occupancy ─────────
create or replace function get_or_create_session(p_cafe_id uuid, p_table_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from table_sessions
    where cafe_id = p_cafe_id and table_id = p_table_id and status in ('active', 'bill_requested')
    order by started_at desc limit 1;
  if v_id is not null then
    -- A new order arriving after "bill requested" means the table isn't done —
    -- back to active so staff don't chase a stale bill-requested banner.
    update table_sessions set status = 'active' where id = v_id and status = 'bill_requested';
    return v_id;
  end if;
  insert into table_sessions (cafe_id, table_id) values (p_cafe_id, p_table_id) returning id into v_id;
  update cafe_tables set status = 'occupied' where id = p_table_id;
  return v_id;
end $$;

-- ── place_order v6: attaches every order to its table session ──────────────
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
                      phone, payment_method, subtotal, total, upsell_shown)
    values (v_cafe_id, v_table_id, v_session_id, v_customer_id, v_seq::text, 'dine_in', 'placed', 'unpaid',
            v_phone, p_payment_method::payment_method, 0, 0, coalesce(p_upsell_shown, false))
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

  update orders
    set subtotal = v_subtotal, total = v_subtotal,
        upsell_item_id = p_upsell_item_id, upsell_taken = v_upsell_taken, upsell_value = v_upsell_value
    where id = v_order_id;

  insert into notifications (cafe_id, type, message, table_id, session_id)
  select v_cafe_id, 'new_order', 'Table ' || t.label || ' placed a new order — #' || v_seq, v_table_id, v_session_id
  from cafe_tables t where t.id = v_table_id;

  return jsonb_build_object('short_code', v_seq::text, 'total', v_subtotal, 'receipt_token', v_receipt);
end $$;

grant execute on function place_order(text, jsonb, text, text, uuid, boolean) to anon, authenticated;
grant execute on function get_or_create_session(uuid, uuid) to anon, authenticated;

-- ── request_bill / call_waiter: rate-limited (2 min cooldown), anon-callable
--    via table token only — no session id guessing needed from the client ───
create or replace function request_bill(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cafe uuid; v_table uuid; v_label text; v_session uuid; v_recent boolean;
begin
  select t.cafe_id, t.id, t.label into v_cafe, v_table, v_label from cafe_tables t where t.token = p_token;
  if v_cafe is null then raise exception 'invalid table'; end if;

  select id into v_session from table_sessions
    where cafe_id = v_cafe and table_id = v_table and status in ('active','bill_requested')
    order by started_at desc limit 1;
  if v_session is null then raise exception 'no active session for this table'; end if;

  select exists (
    select 1 from notifications
    where table_id = v_table and type = 'bill_requested' and created_at > now() - interval '2 minutes'
  ) into v_recent;
  if v_recent then return jsonb_build_object('ok', true, 'throttled', true); end if;

  update table_sessions set status = 'bill_requested' where id = v_session;
  insert into notifications (cafe_id, type, message, table_id, session_id)
  values (v_cafe, 'bill_requested', 'Table ' || v_label || ' requested the bill.', v_table, v_session);

  return jsonb_build_object('ok', true, 'throttled', false);
end $$;

create or replace function call_waiter(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cafe uuid; v_table uuid; v_label text; v_session uuid; v_recent boolean;
begin
  select t.cafe_id, t.id, t.label into v_cafe, v_table, v_label from cafe_tables t where t.token = p_token;
  if v_cafe is null then raise exception 'invalid table'; end if;

  select id into v_session from table_sessions
    where cafe_id = v_cafe and table_id = v_table and status in ('active','bill_requested')
    order by started_at desc limit 1;

  select exists (
    select 1 from notifications
    where table_id = v_table and type = 'call_waiter' and created_at > now() - interval '2 minutes'
  ) into v_recent;
  if v_recent then return jsonb_build_object('ok', true, 'throttled', true); end if;

  insert into notifications (cafe_id, type, message, table_id, session_id)
  values (v_cafe, 'call_waiter', 'Table ' || v_label || ' requires assistance.', v_table, v_session);

  return jsonb_build_object('ok', true, 'throttled', false);
end $$;

grant execute on function request_bill(text) to anon, authenticated;
grant execute on function call_waiter(text) to anon, authenticated;

-- ── move_session: relocate an active session to an empty table ─────────────
create or replace function move_session(p_session_id uuid, p_to_table_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_cafe uuid; v_from_table uuid; v_dest_cafe uuid; v_dest_occupied boolean;
begin
  select cafe_id, table_id into v_cafe, v_from_table from table_sessions
    where id = p_session_id and status in ('active','bill_requested');
  if v_cafe is null then raise exception 'session not found or already closed'; end if;
  if not is_cafe_member(v_cafe) then raise exception 'not authorized'; end if;

  select cafe_id into v_dest_cafe from cafe_tables where id = p_to_table_id;
  if v_dest_cafe is distinct from v_cafe then raise exception 'destination table belongs to a different café'; end if;

  select exists (
    select 1 from table_sessions where table_id = p_to_table_id and status in ('active','bill_requested')
  ) into v_dest_occupied;
  if v_dest_occupied then raise exception 'destination table already has an active session'; end if;

  update table_sessions set table_id = p_to_table_id where id = p_session_id;
  update orders set table_id = p_to_table_id where session_id = p_session_id and status <> 'completed' and status <> 'cancelled';
  update cafe_tables set status = 'available' where id = v_from_table;
  update cafe_tables set status = 'occupied' where id = p_to_table_id;

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (v_cafe, auth.uid(), 'table.moved', 'table_sessions', p_session_id,
          jsonb_build_object('from_table', v_from_table, 'to_table', p_to_table_id));
end $$;

grant execute on function move_session(uuid, uuid) to authenticated;

-- ── close_session: complete every order, close the session, free the table ─
create or replace function close_session(p_session_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_cafe uuid; v_table uuid; v_open_orders int;
begin
  select cafe_id, table_id into v_cafe, v_table from table_sessions where id = p_session_id;
  if v_cafe is null then raise exception 'session not found'; end if;
  if not is_cafe_member(v_cafe) then raise exception 'not authorized'; end if;

  select count(*) into v_open_orders from orders
    where session_id = p_session_id and status not in ('completed','cancelled');
  if v_open_orders > 0 then
    raise exception 'session has % order(s) not yet completed', v_open_orders;
  end if;

  update table_sessions set status = 'closed', closed_at = now(), closed_by = auth.uid() where id = p_session_id;
  update cafe_tables set status = 'available' where id = v_table;
end $$;

grant execute on function close_session(uuid) to authenticated;
