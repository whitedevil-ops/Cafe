-- ============================================================================
-- 0067 — Purchase & Supplier Management. Deferred until now on purpose (per
-- spec: only build this once inventory deduction is trustworthy — 0060
-- closed that loop). Suppliers, purchase orders, and receiving stock against
-- them — receiving credits the SAME inventory ledger every other stock
-- movement already goes through (record_inventory_movement, 0035), not a
-- second parallel path.
--
-- inventory_items.supplier (free text, existed since day one) is untouched —
-- this is a genuinely more structured system living alongside it, not a
-- migration of that field. No attempt is made to guess-link old free-text
-- supplier names to new supplier rows.
--
-- SCOPE: no draft stage — creating a PO means it's been placed with the
-- supplier (matches how a small café actually works: you don't model "not
-- sent yet" as a database state, you just don't open the create dialog).
-- No purchase-invoice/tax handling, no multi-currency — not asked for.
-- ============================================================================

create table if not exists suppliers (
  id           uuid primary key default gen_random_uuid(),
  cafe_id      uuid not null references cafes(id) on delete cascade,
  name         text not null,
  contact_name text,
  phone        text,
  email        text,
  address      text,
  notes        text,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists suppliers_cafe_idx on suppliers (cafe_id);

alter table suppliers enable row level security;
drop policy if exists "member read" on suppliers;
create policy "member read" on suppliers for select using (is_cafe_member(cafe_id));
-- No insert/update/delete policy at all — mutations only through the
-- SECURITY DEFINER functions below, same pattern as coupons/rewards.

create table if not exists purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  cafe_id       uuid not null references cafes(id) on delete cascade,
  supplier_id   uuid not null references suppliers(id) on delete restrict,
  status        text not null default 'ordered'
                check (status in ('ordered', 'partially_received', 'received', 'cancelled')),
  order_date    date not null default current_date,
  expected_date date,
  notes         text,
  cancel_reason text,
  created_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists purchase_orders_cafe_idx on purchase_orders (cafe_id, status, created_at desc);

create table if not exists purchase_order_items (
  id                uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  inventory_item_id uuid not null references inventory_items(id) on delete restrict,
  qty_ordered       numeric(12,3) not null check (qty_ordered > 0),
  qty_received      numeric(12,3) not null default 0 check (qty_received >= 0),
  unit_cost         integer,
  created_at        timestamptz not null default now()
);
create index if not exists purchase_order_items_po_idx on purchase_order_items (purchase_order_id);

alter table purchase_orders enable row level security;
alter table purchase_order_items enable row level security;

drop policy if exists "member read" on purchase_orders;
create policy "member read" on purchase_orders for select using (is_cafe_member(cafe_id));

drop policy if exists "member read" on purchase_order_items;
create policy "member read" on purchase_order_items for select using (
  exists (select 1 from purchase_orders po where po.id = purchase_order_id and is_cafe_member(po.cafe_id))
);

-- ── Suppliers (owner/manager) ────────────────────────────────────────────
create or replace function create_supplier(
  p_cafe_id     uuid,
  p_name        text,
  p_contact_name text default null,
  p_phone       text default null,
  p_email       text default null,
  p_address     text default null,
  p_notes       text default null
) returns suppliers
language plpgsql security definer set search_path = public as $$
declare
  v_role member_role;
  v_row  suppliers%rowtype;
begin
  select role into v_role from cafe_members where cafe_id = p_cafe_id and user_id = auth.uid();
  if v_role is null then raise exception 'not authorized for this café'; end if;
  if v_role not in ('owner', 'manager') then raise exception 'only an owner or manager can add suppliers'; end if;
  if p_name is null or trim(p_name) = '' then raise exception 'enter a supplier name'; end if;

  insert into suppliers (cafe_id, name, contact_name, phone, email, address, notes)
  values (p_cafe_id, trim(p_name),
          nullif(trim(coalesce(p_contact_name, '')), ''), nullif(trim(coalesce(p_phone, '')), ''),
          nullif(trim(coalesce(p_email, '')), ''), nullif(trim(coalesce(p_address, '')), ''),
          nullif(trim(coalesce(p_notes, '')), ''))
  returning * into v_row;

  return v_row;
end $$;

revoke execute on function create_supplier(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function create_supplier(uuid, text, text, text, text, text, text) to authenticated;

create or replace function set_supplier_active(p_supplier_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_cafe_id uuid; v_role member_role;
begin
  select cafe_id into v_cafe_id from suppliers where id = p_supplier_id;
  if v_cafe_id is null then raise exception 'supplier not found'; end if;

  select role into v_role from cafe_members where cafe_id = v_cafe_id and user_id = auth.uid();
  if v_role is null then raise exception 'not authorized for this café'; end if;
  if v_role not in ('owner', 'manager') then
    raise exception 'only an owner or manager can change a supplier''s status';
  end if;

  update suppliers set active = p_active where id = p_supplier_id;
end $$;

revoke execute on function set_supplier_active(uuid, boolean) from public, anon;
grant execute on function set_supplier_active(uuid, boolean) to authenticated;

-- ── Purchase orders (owner/manager to create/cancel) ───────────────────────
create or replace function create_purchase_order(
  p_cafe_id       uuid,
  p_supplier_id   uuid,
  p_items         jsonb, -- [{inventory_item_id, qty, unit_cost}]
  p_expected_date date default null,
  p_notes         text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role    member_role;
  v_po_id   uuid;
  v_item    jsonb;
  v_qty     numeric;
  v_cost    integer;
  v_item_id uuid;
  v_count   integer := 0;
begin
  select role into v_role from cafe_members where cafe_id = p_cafe_id and user_id = auth.uid();
  if v_role is null then raise exception 'not authorized for this café'; end if;
  if v_role not in ('owner', 'manager') then
    raise exception 'only an owner or manager can create a purchase order';
  end if;

  if not exists (select 1 from suppliers where id = p_supplier_id and cafe_id = p_cafe_id) then
    raise exception 'supplier not found';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'add at least one item';
  end if;

  insert into purchase_orders (cafe_id, supplier_id, expected_date, notes, created_by)
  values (p_cafe_id, p_supplier_id, p_expected_date, nullif(trim(coalesce(p_notes, '')), ''), auth.uid())
  returning id into v_po_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_item_id := (v_item->>'inventory_item_id')::uuid;
    v_qty := (v_item->>'qty')::numeric;
    v_cost := nullif(v_item->>'unit_cost', '')::integer;

    if not exists (select 1 from inventory_items where id = v_item_id and cafe_id = p_cafe_id) then
      raise exception 'inventory item not found';
    end if;
    if v_qty is null or v_qty <= 0 then
      raise exception 'quantity must be greater than 0';
    end if;

    insert into purchase_order_items (purchase_order_id, inventory_item_id, qty_ordered, unit_cost)
    values (v_po_id, v_item_id, v_qty, v_cost);
    v_count := v_count + 1;
  end loop;

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (p_cafe_id, auth.uid(), 'purchase_order.created', 'purchase_orders', v_po_id,
          jsonb_build_object('supplier_id', p_supplier_id, 'items', v_count));

  return jsonb_build_object('purchase_order_id', v_po_id);
end $$;

revoke execute on function create_purchase_order(uuid, uuid, jsonb, date, text) from public, anon;
grant execute on function create_purchase_order(uuid, uuid, jsonb, date, text) to authenticated;

-- ── Receiving — any staff member, not just owner/manager: this is an
-- operational stock-count action like any other inventory movement (0035),
-- not a discretionary financial one. Credits the SAME ledger, not a second
-- parallel one. ─────────────────────────────────────────────────────────────
create or replace function receive_purchase_order_items(
  p_purchase_order_id uuid,
  p_items             jsonb -- [{po_item_id, qty_received}]
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id    uuid;
  v_status     text;
  v_role       member_role;
  v_item       jsonb;
  v_poi        record;
  v_qty        numeric;
  v_new_status text;
begin
  select cafe_id, status into v_cafe_id, v_status from purchase_orders where id = p_purchase_order_id;
  if v_cafe_id is null then raise exception 'purchase order not found'; end if;
  if v_status in ('received', 'cancelled') then
    raise exception 'this purchase order is already % and cannot receive more stock', v_status;
  end if;

  select role into v_role from cafe_members where cafe_id = v_cafe_id and user_id = auth.uid();
  if v_role is null then raise exception 'not authorized for this café'; end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'select at least one item to receive';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_poi from purchase_order_items
      where id = (v_item->>'po_item_id')::uuid and purchase_order_id = p_purchase_order_id;
    if v_poi.id is null then raise exception 'purchase order item not found'; end if;

    v_qty := (v_item->>'qty_received')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'received quantity must be greater than 0'; end if;
    if v_poi.qty_received + v_qty > v_poi.qty_ordered then
      raise exception 'cannot receive % — only % of this line remain outstanding',
        v_qty, v_poi.qty_ordered - v_poi.qty_received;
    end if;

    update purchase_order_items set qty_received = qty_received + v_qty where id = v_poi.id;

    perform record_inventory_movement(v_cafe_id, v_poi.inventory_item_id, v_qty, 'Received against purchase order');
  end loop;

  select case when count(*) filter (where qty_received < qty_ordered) = 0 then 'received' else 'partially_received' end
    into v_new_status
    from purchase_order_items where purchase_order_id = p_purchase_order_id;

  update purchase_orders set status = v_new_status where id = p_purchase_order_id;

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (v_cafe_id, auth.uid(), 'purchase_order.received', 'purchase_orders', p_purchase_order_id,
          jsonb_build_object('new_status', v_new_status));

  return jsonb_build_object('status', v_new_status);
end $$;

revoke execute on function receive_purchase_order_items(uuid, jsonb) from public, anon;
grant execute on function receive_purchase_order_items(uuid, jsonb) to authenticated;

create or replace function cancel_purchase_order(p_purchase_order_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_cafe_id uuid; v_status text; v_role member_role;
begin
  select cafe_id, status into v_cafe_id, v_status from purchase_orders where id = p_purchase_order_id;
  if v_cafe_id is null then raise exception 'purchase order not found'; end if;
  if v_status in ('received', 'cancelled') then
    raise exception 'this purchase order is already % and cannot be cancelled', v_status;
  end if;
  if v_status = 'partially_received' then
    raise exception 'this order has already received some stock — it cannot be cancelled outright';
  end if;

  select role into v_role from cafe_members where cafe_id = v_cafe_id and user_id = auth.uid();
  if v_role is null then raise exception 'not authorized for this café'; end if;
  if v_role not in ('owner', 'manager') then
    raise exception 'only an owner or manager can cancel a purchase order';
  end if;

  if p_reason is null or trim(p_reason) = '' then raise exception 'a cancellation reason is required'; end if;

  update purchase_orders set status = 'cancelled', cancel_reason = trim(p_reason) where id = p_purchase_order_id;

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (v_cafe_id, auth.uid(), 'purchase_order.cancelled', 'purchase_orders', p_purchase_order_id,
          jsonb_build_object('reason', trim(p_reason)));
end $$;

revoke execute on function cancel_purchase_order(uuid, text) from public, anon;
grant execute on function cancel_purchase_order(uuid, text) to authenticated;
