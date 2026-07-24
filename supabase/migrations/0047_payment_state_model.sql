-- ============================================================================
-- 0047 — One payment-state model. Money is the single source of truth.
--
-- The ledger was already authoritative (order_outstanding / record_payment /
-- recompute_order_payment_status, and list_bills derives status from summed
-- payments). The bug was that NOTHING fed the ledger at the counter: picking
-- "Cash" in the POS only stamped orders.payment_method and never recorded a
-- payment, so a cash takeaway read METHOD = cash / STATUS = unpaid — the exact
-- contradiction the product must never produce.
--
-- This migration closes that at the source:
--   1. staff_place_order can SETTLE the bill atomically when staff confirm
--      money was received — it records the full payment through the one
--      validated, audited record_payment path. When the bill is deliberately
--      left unpaid ("Payment Pending"), the tender is neutralised (never a
--      real method on an unpaid bill) and the exception is audited.
--   2. outstanding_summary splits the unpaid balance by order type so the
--      owner dashboard can show where money is pending (dine-in vs takeaway).
--
-- No new tables, no status booleans. Status is still computed from money.
-- ============================================================================

-- ── 1. Payment-first placement ─────────────────────────────────────────────
-- Adding parameters changes the signature, which would create a SECOND
-- overload (the PGRST203 trap hit in 0043). Drop the 9-arg version first so
-- exactly one staff_place_order exists.
drop function if exists staff_place_order(uuid, jsonb, order_type, uuid, text, text, text, text, numeric);

create or replace function staff_place_order(
  p_cafe_id        uuid,
  p_items          jsonb,
  p_order_type     order_type default 'dine_in',
  p_table_id       uuid default null,
  p_payment_method text default 'counter',
  p_customer_phone text default null,
  p_customer_name  text default null,
  p_discount_type  text default null,
  p_discount_value numeric default 0,
  p_settle         boolean default false,   -- staff confirmed money received now
  p_pending_reason text default null        -- why a takeaway is left unpaid
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

  -- Placed unpaid; a settle (below) records the money and flips the status.
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

  select t.subtotal, t.discount, t.tax, t.service_charge, t.total
    into v_subtotal, v_discount, v_tax, v_svc, v_total
    from apply_order_taxes(v_order_id, v_discount) t;

  if v_discount > 0 then
    insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
    values (p_cafe_id, auth.uid(), 'order.discount_applied', 'orders', v_order_id,
            jsonb_build_object('type', p_discount_type, 'requested', p_discount_value,
                                'amount', v_discount, 'role', v_role));
  end if;

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (p_cafe_id, auth.uid(), 'order.created', 'orders', v_order_id,
          jsonb_build_object('source', 'pos', 'total', v_total, 'order_type', p_order_type, 'table_id', p_table_id));

  -- ── Settlement: the whole point of this migration ────────────────────────
  -- If staff confirmed money was received, book it NOW through the one trusted
  -- path so METHOD and STATUS can never disagree. record_payment validates the
  -- amount against outstanding, writes the immutable (audited) payment row,
  -- re-stamps the real tender, and recomputes payment_status → paid.
  if p_settle then
    if p_payment_method not in ('cash', 'card', 'upi') then
      raise exception 'to collect payment now, choose cash, card or UPI';
    end if;
    if v_total > 0 then
      perform record_payment(v_order_id, v_total, p_payment_method, null, 'pos', null);
      v_settled := true;
    end if;
  else
    -- Deliberately unpaid. Never leave a real tender on an unpaid bill, and
    -- record WHY a takeaway is walking out without paying, with actor + time.
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
end $$;

revoke execute on function staff_place_order(uuid, jsonb, order_type, uuid, text, text, text, text, numeric, boolean, text) from public, anon;
grant execute on function staff_place_order(uuid, jsonb, order_type, uuid, text, text, text, text, numeric, boolean, text) to authenticated;


-- ── 2. Outstanding split by order type, for the owner dashboard ────────────
create or replace function outstanding_summary(p_cafe_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_collected integer;
  v_refunded  integer;
  v_out       integer;
  v_orders    integer;
  v_tables    integer;
  v_dine      integer;
  v_take      integer;
begin
  if not is_cafe_member(p_cafe_id) then raise exception 'not authorized'; end if;

  select coalesce(sum(amount), 0) into v_collected
    from payments where cafe_id = p_cafe_id and created_at >= p_from and created_at < p_to;

  select coalesce(sum(amount), 0) into v_refunded
    from refunds where cafe_id = p_cafe_id and status = 'completed'
      and created_at >= p_from and created_at < p_to;

  with unpaid as (
    select o.id, o.type, o.table_id,
           greatest(0, o.total - coalesce((select sum(amount) from payments p where p.order_id = o.id), 0)) as due
      from orders o
     where o.cafe_id = p_cafe_id and o.status <> 'cancelled'
       and o.created_at >= p_from and o.created_at < p_to
  )
  select coalesce(sum(due), 0),
         count(*) filter (where due > 0),
         count(distinct table_id) filter (where due > 0 and table_id is not null),
         coalesce(sum(due) filter (where type = 'dine_in'), 0),
         coalesce(sum(due) filter (where type = 'takeaway'), 0)
    into v_out, v_orders, v_tables, v_dine, v_take from unpaid;

  return jsonb_build_object(
    'collected', v_collected, 'refunded', v_refunded,
    'outstanding', v_out, 'unpaid_orders', v_orders, 'unpaid_tables', v_tables,
    'unpaid_dine_in', v_dine, 'unpaid_takeaway', v_take);
end $$;

revoke execute on function outstanding_summary(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function outstanding_summary(uuid, timestamptz, timestamptz) to authenticated;


-- ── 3. Settle a whole table session through the ledger ─────────────────────
-- Splitting a table bill used to insert session-level payment rows directly,
-- which the per-order payment_status never saw — so a fully-split table still
-- read UNPAID in Bills. Allocate the money across the session's unpaid orders
-- (oldest first) through record_payment so every surface agrees.
create or replace function record_session_payment(
  p_session_id  uuid,
  p_amount      integer,
  p_method      text,
  p_split_label text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id   uuid;
  v_remaining integer;
  v_take      integer;
  v_o         record;
  v_applied   integer := 0;
begin
  select cafe_id into v_cafe_id from table_sessions where id = p_session_id;
  if v_cafe_id is null then raise exception 'session not found'; end if;
  if not is_cafe_member(v_cafe_id) then raise exception 'not authorized'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be greater than zero'; end if;
  if p_method not in ('cash', 'card', 'upi') then raise exception 'invalid payment method'; end if;

  v_remaining := p_amount;
  for v_o in
    select o.id from orders o
     where o.session_id = p_session_id and o.status <> 'cancelled'
       and order_outstanding(o.id) > 0
     order by o.created_at asc
  loop
    exit when v_remaining <= 0;
    v_take := least(v_remaining, order_outstanding(v_o.id));
    if v_take > 0 then
      perform record_payment(v_o.id, v_take, p_method, p_split_label, 'split', null);
      v_remaining := v_remaining - v_take;
      v_applied   := v_applied + v_take;
    end if;
  end loop;

  return jsonb_build_object('applied', v_applied, 'unapplied', v_remaining);
end $$;

revoke execute on function record_session_payment(uuid, integer, text, text) from public, anon;
grant execute on function record_session_payment(uuid, integer, text, text) to authenticated;
