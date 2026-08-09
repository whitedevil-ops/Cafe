-- ============================================================================
-- 0123 — Combo meals (bundle deals).
--
-- "Any Pizza + Any Mojito ₹199". "Meal for Two ₹379 = a wrap + garlic bread +
-- fries + any pizza + any two mojitos." Cafés sell these constantly and
-- KhaoPiyo had no way to represent one: the menu is individual items with
-- sizes and add-ons, and the only multi-item mechanism was a coupon, which
-- just takes a percent/flat amount off the whole cart.
--
-- THE CORE DECISION: a combo's components are inserted as REAL, REAL-PRICED
-- order_items rows, and the bundle saving is applied as a discount. NOT as a
-- single opaque line, and NOT as ₹0 component rows. Reasons, each verified
-- against the existing code rather than assumed:
--
--   * The kitchen has to know what to actually make. Components as real rows
--     means the KOT/KDS shows "1 Pizza, 1 Wrap, 2 Mojito" with no new code.
--   * deduct_stock_for_order_item (0071:585) keys off menu_item_id + qty and
--     ignores price, so recipes/inventory deduct per component either way —
--     but only real rows give it something to deduct.
--   * apply_order_taxes (0037:84) already recomputes subtotal from
--     order_items and allocates a passed-in discount PROPORTIONALLY across
--     lines, writing per-line taxable_value/tax_amount. A combo saving is
--     just another discount into machinery that already exists — GST per
--     component comes out right for free.
--   * profitability_report (0052:118) measures revenue as
--     coalesce(taxable_value, price*qty) against cost_snapshot*qty. Real
--     prices + proportional discount put margin on the right item. ₹0
--     components would report a NEGATIVE margin on every item in every combo.
--   * items_categories_report (0063:34) measures raw price*qty, so real
--     prices keep per-item sales figures honest.
--
-- So: components at menu price, savings = max(0, sum_of_parts − combo price),
-- folded into the discount already being handed to apply_order_taxes.
--
-- ONE SHARED EXPANDER, NOT TWO COPIES. place_order (QR, latest body 0106:104)
-- and staff_place_order (POS, latest body 0120:97) duplicate their item loop
-- verbatim — a known drift risk called out in this project's own audit. The
-- combo logic lands in expand_combo_line() once and both engines call it,
-- rather than a third copy-paste.
--
-- Neither engine's SQL signature changes: a combo travels as a p_items
-- element carrying combo_id + selections, the same "extend the jsonb element"
-- pattern 0120 used for reward_id (0120:30-31).
--
-- ALSO FIXED HERE (small, found while reading apply_order_taxes for the
-- above): its last-row remainder branch (0037:130) could hand a line a
-- discount share larger than the line is worth, producing a NEGATIVE
-- taxable_value. Harmless between equal-priced lines, but it bites any ₹0
-- line — which the reward feature (0120) already creates today. Now clamped.
-- ============================================================================

-- ── Schema ─────────────────────────────────────────────────────────────────
create table if not exists combos (
  id          uuid primary key default gen_random_uuid(),
  cafe_id     uuid not null references cafes(id) on delete cascade,
  name        text not null,
  description text,
  price       integer not null check (price >= 0),   -- integer rupees, house convention
  image_url   text,
  active      boolean not null default true,
  sort        integer not null default 0,
  created_at  timestamptz not null default now()
);

-- A slot is one "row" of the combo as printed on the menu board:
--   fixed  → a specific item ("Cheese Garlic Bread")
--   choice → pick qty items from a category ("Any Two Mojito" = choice, qty 2)
create table if not exists combo_slots (
  id           uuid primary key default gen_random_uuid(),
  combo_id     uuid not null references combos(id) on delete cascade,
  label        text not null,
  kind         text not null check (kind in ('fixed', 'choice')),
  menu_item_id uuid references menu_items(id) on delete cascade,          -- fixed only
  variant_id   uuid references menu_item_variants(id) on delete cascade,  -- fixed only, if the item has sizes
  category_id  uuid references menu_categories(id) on delete cascade,     -- choice only
  qty          integer not null default 1 check (qty > 0),
  sort         integer not null default 0,
  constraint combo_slot_shape check (
    (kind = 'fixed'  and menu_item_id is not null and category_id is null) or
    (kind = 'choice' and category_id  is not null and menu_item_id is null and variant_id is null)
  )
);

create index if not exists combos_cafe_idx on combos (cafe_id, sort);
create index if not exists combo_slots_combo_idx on combo_slots (combo_id, sort);

-- combo_id = which combo this row came from; combo_group = which INSTANCE of
-- it (two differently-configured "Any Pizza + Mojito" lines in one order are
-- two groups), so the receipt can group components under their combo.
alter table order_items add column if not exists combo_id    uuid references combos(id) on delete set null;
alter table order_items add column if not exists combo_group uuid;
create index if not exists order_items_combo_group_idx on order_items (combo_group);

-- RLS mirroring the menu tables (schema.sql:450-467): members manage, anon
-- reads (the QR digital menu is public, and lib/menu-cache.ts reads it with a
-- plain anon client).
alter table combos      enable row level security;
alter table combo_slots enable row level security;

drop policy if exists "member all" on combos;
drop policy if exists "public read" on combos;
create policy "member all"  on combos for all using (is_cafe_member(cafe_id)) with check (is_cafe_member(cafe_id));
create policy "public read" on combos for select to anon using (true);

drop policy if exists "public read" on combo_slots;
create policy "public read" on combo_slots for select using (true);

-- Writes go through the owner/manager RPCs below, same posture as every other
-- money-shaped table since 0050.
revoke insert, update, delete on combos      from authenticated, anon;
revoke insert, update, delete on combo_slots from authenticated, anon;

-- ── Slot validation + replace-all sync (internal) ──────────────────────────
-- Replace-all rather than diffing, the same call this project already made
-- for variants/add-ons (menu-manager.tsx syncModifiers) — at a handful of
-- slots per combo, diffing buys nothing.
create or replace function sync_combo_slots(p_combo_id uuid, p_cafe_id uuid, p_slots jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_slot         jsonb;
  v_kind         text;
  v_label        text;
  v_qty          integer;
  v_item_id      uuid;
  v_variant_id   uuid;
  v_category_id  uuid;
  v_has_variants boolean;
  v_i            integer := 0;
begin
  delete from combo_slots where combo_id = p_combo_id;

  if p_slots is null or jsonb_array_length(p_slots) = 0 then
    raise exception 'a combo needs at least one item';
  end if;

  for v_slot in select * from jsonb_array_elements(p_slots) loop
    v_kind  := coalesce(v_slot->>'kind', '');
    v_label := nullif(trim(coalesce(v_slot->>'label', '')), '');
    v_qty   := greatest(1, coalesce((v_slot->>'qty')::int, 1));

    if v_kind not in ('fixed', 'choice') then raise exception 'invalid slot type'; end if;
    if v_label is null then raise exception 'every combo row needs a label'; end if;

    if v_kind = 'fixed' then
      v_item_id    := nullif(v_slot->>'menu_item_id', '')::uuid;
      v_variant_id := nullif(v_slot->>'variant_id', '')::uuid;

      if not exists (select 1 from menu_items
                      where id = v_item_id and cafe_id = p_cafe_id and archived = false) then
        raise exception 'menu item not found for "%"', v_label;
      end if;

      v_has_variants := exists (select 1 from menu_item_variants where menu_item_id = v_item_id);
      if v_has_variants and v_variant_id is null then
        raise exception '"%" has sizes — pick one', v_label;
      end if;
      if v_variant_id is not null and not exists (
        select 1 from menu_item_variants where id = v_variant_id and menu_item_id = v_item_id
      ) then
        raise exception 'invalid size for "%"', v_label;
      end if;

      insert into combo_slots (combo_id, label, kind, menu_item_id, variant_id, qty, sort)
      values (p_combo_id, v_label, 'fixed', v_item_id, v_variant_id, v_qty, v_i);
    else
      v_category_id := nullif(v_slot->>'category_id', '')::uuid;
      if not exists (select 1 from menu_categories where id = v_category_id and cafe_id = p_cafe_id) then
        raise exception 'category not found for "%"', v_label;
      end if;

      insert into combo_slots (combo_id, label, kind, category_id, qty, sort)
      values (p_combo_id, v_label, 'choice', v_category_id, v_qty, v_i);
    end if;

    v_i := v_i + 1;
  end loop;
end $$;

revoke execute on function sync_combo_slots(uuid, uuid, jsonb) from public, anon, authenticated;

-- ── Management RPCs (owner/manager), same shape as create_reward (0064) ─────
create or replace function create_combo(
  p_cafe_id     uuid,
  p_name        text,
  p_price       integer,
  p_slots       jsonb,
  p_description text default null
) returns combos
language plpgsql security definer set search_path = public as $$
declare
  v_role member_role;
  v_row  combos%rowtype;
begin
  select role into v_role from cafe_members where cafe_id = p_cafe_id and user_id = auth.uid();
  if v_role is null then raise exception 'not authorized for this café'; end if;
  if v_role not in ('owner', 'manager') then
    raise exception 'only an owner or manager can create combos';
  end if;

  if p_name is null or trim(p_name) = '' then raise exception 'enter a combo name'; end if;
  if p_price is null or p_price < 0 then raise exception 'enter a valid combo price'; end if;

  insert into combos (cafe_id, name, description, price, sort)
  values (p_cafe_id, trim(p_name), nullif(trim(coalesce(p_description, '')), ''), p_price,
          coalesce((select max(sort) + 1 from combos where cafe_id = p_cafe_id), 0))
  returning * into v_row;

  perform sync_combo_slots(v_row.id, p_cafe_id, p_slots);
  return v_row;
end $$;

revoke execute on function create_combo(uuid, text, integer, jsonb, text) from public, anon;
grant execute on function create_combo(uuid, text, integer, jsonb, text) to authenticated;

create or replace function update_combo(
  p_combo_id    uuid,
  p_name        text,
  p_price       integer,
  p_slots       jsonb,
  p_description text default null
) returns combos
language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id uuid;
  v_role    member_role;
  v_row     combos%rowtype;
begin
  select cafe_id into v_cafe_id from combos where id = p_combo_id;
  if v_cafe_id is null then raise exception 'combo not found'; end if;

  select role into v_role from cafe_members where cafe_id = v_cafe_id and user_id = auth.uid();
  if v_role is null then raise exception 'not authorized for this café'; end if;
  if v_role not in ('owner', 'manager') then
    raise exception 'only an owner or manager can edit combos';
  end if;

  if p_name is null or trim(p_name) = '' then raise exception 'enter a combo name'; end if;
  if p_price is null or p_price < 0 then raise exception 'enter a valid combo price'; end if;

  update combos
     set name = trim(p_name),
         description = nullif(trim(coalesce(p_description, '')), ''),
         price = p_price
   where id = p_combo_id
  returning * into v_row;

  perform sync_combo_slots(p_combo_id, v_cafe_id, p_slots);
  return v_row;
end $$;

revoke execute on function update_combo(uuid, text, integer, jsonb, text) from public, anon;
grant execute on function update_combo(uuid, text, integer, jsonb, text) to authenticated;

create or replace function set_combo_active(p_combo_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id uuid;
  v_role    member_role;
begin
  select cafe_id into v_cafe_id from combos where id = p_combo_id;
  if v_cafe_id is null then raise exception 'combo not found'; end if;

  select role into v_role from cafe_members where cafe_id = v_cafe_id and user_id = auth.uid();
  if v_role is null then raise exception 'not authorized for this café'; end if;
  if v_role not in ('owner', 'manager') then
    raise exception 'only an owner or manager can change a combo';
  end if;

  update combos set active = p_active where id = p_combo_id;
end $$;

revoke execute on function set_combo_active(uuid, boolean) from public, anon;
grant execute on function set_combo_active(uuid, boolean) to authenticated;

-- Hard delete is safe: order_items.combo_id is `on delete set null`, so past
-- orders keep their component rows and their own name/price snapshots — they
-- just lose the back-reference. Same tradeoff as menu items being deletable.
create or replace function delete_combo(p_combo_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id uuid;
  v_role    member_role;
begin
  select cafe_id into v_cafe_id from combos where id = p_combo_id;
  if v_cafe_id is null then raise exception 'combo not found'; end if;

  select role into v_role from cafe_members where cafe_id = v_cafe_id and user_id = auth.uid();
  if v_role is null then raise exception 'not authorized for this café'; end if;
  if v_role not in ('owner', 'manager') then
    raise exception 'only an owner or manager can delete combos';
  end if;

  delete from combos where id = p_combo_id;
end $$;

revoke execute on function delete_combo(uuid) from public, anon;
grant execute on function delete_combo(uuid) to authenticated;

-- ── The expander — called by BOTH order engines ────────────────────────────
-- Inserts one real order_items row per slot (per distinct pick within a
-- choice slot) and returns the bundle saving for this line.
--
-- Every component is re-resolved from menu_items server-side and a choice
-- pick must genuinely belong to that slot's category — a client cannot
-- smuggle a ₹500 item into a ₹99 combo slot by editing the payload.
create or replace function expand_combo_line(
  p_order_id   uuid,
  p_cafe_id    uuid,
  p_combo_id   uuid,
  p_selections jsonb,
  p_qty        integer
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_combo        combos%rowtype;
  v_slot         record;
  v_pick         record;
  v_group        uuid := gen_random_uuid();
  v_parts        integer := 0;
  v_qty          integer := greatest(1, coalesce(p_qty, 1));
  v_sel_count    integer;
  v_item_id      uuid;
  v_name         text;
  v_price        integer;
  v_unit         integer;
  v_mods         jsonb;
  v_vname        text;
  v_vdelta       integer;
  v_has_variants boolean;
  v_line_qty     integer;
begin
  select * into v_combo from combos where id = p_combo_id and cafe_id = p_cafe_id;
  if v_combo.id is null then raise exception 'combo not found'; end if;
  if not v_combo.active then raise exception 'combo "%" is no longer available', v_combo.name; end if;

  for v_slot in select * from combo_slots where combo_id = p_combo_id order by sort, id loop
    if v_slot.kind = 'fixed' then
      select mi.id, mi.name, mi.price into v_item_id, v_name, v_price
        from menu_items mi
       where mi.id = v_slot.menu_item_id and mi.cafe_id = p_cafe_id
         and mi.available = true and mi.archived = false;
      if v_item_id is null then
        raise exception '% is not available right now', v_slot.label;
      end if;

      v_unit := v_price;
      v_mods := '[]'::jsonb;
      if v_slot.variant_id is not null then
        select name, price_delta into v_vname, v_vdelta
          from menu_item_variants where id = v_slot.variant_id and menu_item_id = v_item_id;
        if v_vname is null then raise exception 'invalid size on "%"', v_slot.label; end if;
        v_unit := v_unit + v_vdelta;
        v_mods := v_mods || jsonb_build_object('name', v_vname, 'price', v_vdelta);
        v_name := v_name || ' (' || v_vname || ')';
      end if;

      v_line_qty := v_slot.qty * v_qty;
      insert into order_items (order_id, menu_item_id, name, price, qty, modifiers, variant_id, combo_id, combo_group)
      values (p_order_id, v_item_id, v_name, v_unit, v_line_qty, v_mods, v_slot.variant_id, p_combo_id, v_group);
      v_parts := v_parts + v_unit * v_line_qty;

    else
      select count(*) into v_sel_count
        from jsonb_array_elements(coalesce(p_selections, '[]'::jsonb)) s
       where nullif(s->>'slot_id', '')::uuid = v_slot.id;
      if v_sel_count <> v_slot.qty then
        raise exception 'pick % option(s) for "%"', v_slot.qty, v_slot.label;
      end if;

      -- Identical picks within one slot collapse into a single line, so
      -- "any four mojito" all-the-same reads as "4 × Mint Mojito" on the
      -- kitchen ticket rather than four separate one-off rows.
      for v_pick in
        select nullif(s->>'item_id', '')::uuid    as item_id,
               nullif(s->>'variant_id', '')::uuid as variant_id,
               count(*)::int                      as picks
          from jsonb_array_elements(coalesce(p_selections, '[]'::jsonb)) s
         where nullif(s->>'slot_id', '')::uuid = v_slot.id
         group by 1, 2
      loop
        select mi.id, mi.name, mi.price into v_item_id, v_name, v_price
          from menu_items mi
         where mi.id = v_pick.item_id and mi.cafe_id = p_cafe_id
           and mi.category_id = v_slot.category_id
           and mi.available = true and mi.archived = false;
        if v_item_id is null then
          raise exception 'that choice is not available for "%"', v_slot.label;
        end if;

        v_unit := v_price;
        v_mods := '[]'::jsonb;

        v_has_variants := exists (select 1 from menu_item_variants where menu_item_id = v_item_id);
        if v_has_variants and v_pick.variant_id is null then
          raise exception 'choose a size for %', v_name;
        end if;
        if v_pick.variant_id is not null then
          select name, price_delta into v_vname, v_vdelta
            from menu_item_variants where id = v_pick.variant_id and menu_item_id = v_item_id;
          if v_vname is null then raise exception 'invalid size for %', v_name; end if;
          v_unit := v_unit + v_vdelta;
          v_mods := v_mods || jsonb_build_object('name', v_vname, 'price', v_vdelta);
          v_name := v_name || ' (' || v_vname || ')';
        end if;

        v_line_qty := v_pick.picks * v_qty;
        insert into order_items (order_id, menu_item_id, name, price, qty, modifiers, variant_id, combo_id, combo_group)
        values (p_order_id, v_item_id, v_name, v_unit, v_line_qty, v_mods, v_pick.variant_id, p_combo_id, v_group);
        v_parts := v_parts + v_unit * v_line_qty;
      end loop;
    end if;
  end loop;

  -- A combo priced ABOVE its parts never produces a negative discount.
  return greatest(0, v_parts - v_combo.price * v_qty);
end $$;

revoke execute on function expand_combo_line(uuid, uuid, uuid, jsonb, integer) from public, anon, authenticated;

-- ── apply_order_taxes: clamp each line's discount share to the line ─────────
-- Verbatim from 0037 apart from the two clamp lines noted below.
create or replace function apply_order_taxes(p_order_id uuid, p_discount integer default 0)
returns table(subtotal integer, discount integer, tax integer, service_charge integer, total integer)
language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id    uuid;
  v_registered boolean;
  v_inclusive  boolean;
  v_default    numeric;
  v_svc_pct    numeric;
  v_subtotal   integer := 0;
  v_rows       integer := 0;
  v_seen       integer := 0;
  v_disc       integer := 0;
  v_allocated  integer := 0;
  v_share      integer;
  v_line       record;
  v_line_val   integer;
  v_taxable    integer;
  v_line_tax   integer;
  v_tax        integer := 0;
  v_svc        integer := 0;
  v_total      integer := 0;
begin
  select o.cafe_id into v_cafe_id from orders o where o.id = p_order_id;
  if v_cafe_id is null then raise exception 'order not found'; end if;

  select c.gst_registered, c.tax_inclusive, coalesce(c.tax_percent, 0), coalesce(c.service_charge, 0)
    into v_registered, v_inclusive, v_default, v_svc_pct
    from cafes c where c.id = v_cafe_id;

  select coalesce(sum(oi.price * oi.qty), 0), count(*)
    into v_subtotal, v_rows
    from order_items oi where oi.order_id = p_order_id;

  v_disc := least(greatest(coalesce(p_discount, 0), 0), v_subtotal);

  for v_line in
    select oi.id, oi.price, oi.qty, oi.tax_percent
      from order_items oi where oi.order_id = p_order_id
      order by oi.id
  loop
    v_seen := v_seen + 1;
    v_line_val := v_line.price * v_line.qty;

    -- Last line absorbs the rounding remainder so the allocated discount
    -- sums to exactly v_disc and never drifts a rupee.
    if v_seen = v_rows then
      v_share := v_disc - v_allocated;
    elsif v_subtotal > 0 then
      v_share := round(v_disc::numeric * v_line_val / v_subtotal);
    else
      v_share := 0;
    end if;

    -- 0123: never allocate a line more (or less) discount than the line is
    -- worth. Without this, a ₹0 line landing last by uuid takes the whole
    -- remainder and ends up with a NEGATIVE taxable_value — reachable today
    -- via the ₹0 reward lines added in 0120. Costs at most a rupee of
    -- allocated-vs-charged drift; orders.total is computed from
    -- v_subtotal - v_disc directly and is unaffected.
    v_share := greatest(0, least(v_share, v_line_val));
    v_allocated := v_allocated + v_share;

    if not v_registered then
      v_taxable  := v_line_val - v_share;
      v_line_tax := 0;
    elsif v_inclusive then
      v_taxable  := round((v_line_val - v_share)::numeric * 100
                          / (100 + coalesce(v_line.tax_percent, v_default)));
      v_line_tax := (v_line_val - v_share) - v_taxable;
    else
      v_taxable  := v_line_val - v_share;
      v_line_tax := round(v_taxable::numeric * coalesce(v_line.tax_percent, v_default) / 100);
    end if;

    update order_items
       set taxable_value = v_taxable,
           tax_amount    = v_line_tax
     where id = v_line.id;

    v_tax := v_tax + v_line_tax;
  end loop;

  v_svc := round((v_subtotal - v_disc)::numeric * v_svc_pct / 100);

  if v_inclusive and v_registered then
    v_total := (v_subtotal - v_disc) + v_svc;
  else
    v_total := (v_subtotal - v_disc) + v_tax + v_svc;
  end if;

  update orders
     set subtotal = v_subtotal, discount = v_disc, tax = v_tax,
         service_charge = v_svc, total = v_total
   where id = p_order_id;

  return query select v_subtotal, v_disc, v_tax, v_svc, v_total;
end $$;

revoke execute on function apply_order_taxes(uuid, integer) from public, anon;
grant execute on function apply_order_taxes(uuid, integer) to authenticated;

-- ── place_order (QR) — verbatim from 0106 plus the combo branch ────────────
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

    -- Combo line: expands into real, real-priced component rows; the bundle
    -- saving comes back and is folded into the discount below.
    v_combo_id := nullif(v_item->>'combo_id', '')::uuid;
    if v_combo_id is not null then
      v_combo_savings := v_combo_savings + expand_combo_line(
        v_order_id, v_cafe_id, v_combo_id, coalesce(v_item->'selections', '[]'::jsonb), v_qty);
      continue;
    end if;

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

    insert into order_items (order_id, menu_item_id, name, price, qty, modifiers, instructions, variant_id)
      values (v_order_id, v_id, v_name, v_unit, v_qty, v_mods, v_note, v_variant_id);

    if p_upsell_item_id is not null and v_id = p_upsell_item_id then
      v_upsell_taken := true;
      v_upsell_value := v_unit * v_qty;
    end if;
  end loop;

  -- Read the subtotal back from the rows actually written rather than a
  -- loop accumulator: combo components are inserted inside expand_combo_line
  -- and would otherwise be missed. Same figure apply_order_taxes recomputes.
  select coalesce(sum(price * qty), 0) into v_subtotal
    from order_items where order_id = v_order_id;

  if p_coupon_code is not null and trim(p_coupon_code) <> '' then
    perform pg_advisory_xact_lock(hashtext('coupon:' || v_cafe_id::text || ':' || upper(trim(p_coupon_code))));
    select coalesce(array_agg(distinct mi.category_id), array[]::uuid[]) into v_cat_ids
      from order_items oi join menu_items mi on mi.id = oi.menu_item_id
      where oi.order_id = v_order_id and mi.category_id is not null;
    -- Coupon applies to what the guest actually pays for the combo, not the
    -- inflated sum-of-parts, so a percent coupon can't over-discount.
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

grant execute on function place_order(text, jsonb, text, text, uuid, boolean, uuid, text, text) to anon, authenticated;

-- ── staff_place_order (POS) — verbatim from 0120 plus the combo branch ─────
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

    -- Combo line: expands into real, real-priced component rows.
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

    -- Reward redemption (0120): resolved before addons so a free line can
    -- never pick up chargeable addon value on top of the ₹0 price.
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

    -- Debit points for this reward line, atomically with the order.
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

  -- Read back from the rows actually written — combo components are inserted
  -- inside expand_combo_line and a loop accumulator would miss them.
  select coalesce(sum(price * qty), 0) into v_subtotal
    from order_items where order_id = v_order_id;
  -- Manual/coupon discounts are judged against what the guest actually pays
  -- for combos, not the inflated sum-of-parts.
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

grant execute on function staff_place_order(uuid, jsonb, order_type, uuid, text, text, text, text, numeric, boolean, text, uuid, text) to authenticated;

-- ── get_receipt — verbatim from 0120 plus combo grouping per item ──────────
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
        'is_reward', i.reward_id is not null,
        'combo_group', i.combo_group,
        'combo_name', cb.name,
        'combo_price', cb.price)
        -- Components of one combo stay adjacent so the receipt can render
        -- them under a single heading.
        order by i.combo_group nulls first, i.name), '[]'::jsonb)
      from order_items i
      left join combos cb on cb.id = i.combo_id
      where i.order_id = o.id)
  )
  from orders o
  join cafes c on c.id = o.cafe_id
  left join cafe_tables t on t.id = o.table_id
  where o.receipt_token = p_token;
$$;

grant execute on function get_receipt(uuid) to anon, authenticated;
