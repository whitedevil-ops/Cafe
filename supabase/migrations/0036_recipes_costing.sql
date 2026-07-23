-- ============================================================================
-- 0036 — Recipes (bill of materials) + food costing, and an OPTIONAL
-- automatic stock deduction when an order is placed.
--
-- Confirmed before writing: no recipe/BOM table exists anywhere in
-- schema.sql or migrations 0001–0035 (schema.sql line 308 literally says
-- "clean tables now, recipes later"). This is genuinely new, unlike
-- expenses/inventory — checked rather than assumed, after Phase 6.
--
-- WHY COST IS COMPUTED, NEVER STORED ON menu_items: an item's food cost is
-- entirely derived from its recipe rows × each ingredient's current cost.
-- Storing it would mean invalidating it every time any ingredient's cost
-- changed — the same "derived value drifting from its source" trap this
-- project already avoids for loyalty balances and (as of 0035) inventory
-- stock. Computed on read instead.
-- ============================================================================

create table if not exists recipe_items (
  id                uuid primary key default gen_random_uuid(),
  cafe_id           uuid not null references cafes(id) on delete cascade,
  menu_item_id      uuid not null references menu_items(id) on delete cascade,
  inventory_item_id uuid not null references inventory_items(id) on delete cascade,
  qty               numeric(12,3) not null check (qty > 0),
  created_at        timestamptz not null default now(),
  unique (menu_item_id, inventory_item_id)
);
create index if not exists recipe_items_cafe_idx on recipe_items (cafe_id);
create index if not exists recipe_items_menu_item_idx on recipe_items (menu_item_id);

alter table recipe_items enable row level security;

-- Matches the access level of the two tables it joins (menu_items and
-- inventory_items are both "member all"), rather than inventing a stricter
-- rule that would leave a manager able to see both sides but not the link.
drop policy if exists "member all" on recipe_items;
create policy "member all" on recipe_items for all
  using (is_cafe_member(cafe_id)) with check (is_cafe_member(cafe_id));

-- ── Food costing ────────────────────────────────────────────────────────────
-- inventory_items.cost is "cost per unit" in whole rupees and is nullable —
-- an item with no cost set contributes 0 and is reported separately via
-- missing_cost, so a café can tell "this dish costs ₹0 to make" (wrong)
-- apart from "I haven't priced its ingredients yet" (the real situation).
create or replace function menu_item_costs(p_cafe_id uuid)
returns table(
  menu_item_id uuid,
  name         text,
  price        integer,
  food_cost    numeric,
  margin       numeric,
  margin_pct   numeric,
  ingredients  integer,
  missing_cost integer
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_cafe_member(p_cafe_id) then
    raise exception 'not authorized';
  end if;
  return query
    select
      mi.id,
      mi.name,
      mi.price,
      coalesce(sum(ri.qty * coalesce(ii.cost, 0)), 0)::numeric as food_cost,
      (mi.price - coalesce(sum(ri.qty * coalesce(ii.cost, 0)), 0))::numeric as margin,
      case when mi.price > 0
        then round(((mi.price - coalesce(sum(ri.qty * coalesce(ii.cost, 0)), 0)) / mi.price) * 100, 1)
        else 0 end::numeric as margin_pct,
      count(ri.id)::integer as ingredients,
      count(ri.id) filter (where ii.cost is null)::integer as missing_cost
    from menu_items mi
    left join recipe_items ri on ri.menu_item_id = mi.id
    left join inventory_items ii on ii.id = ri.inventory_item_id
    where mi.cafe_id = p_cafe_id and mi.archived = false
    group by mi.id, mi.name, mi.price
    order by mi.name;
end $$;

revoke execute on function menu_item_costs(uuid) from public, anon;
grant execute on function menu_item_costs(uuid) to authenticated;

-- ── OPTIONAL automatic stock deduction ──────────────────────────────────────
-- Defaults OFF, per café. Reasoning: a café that hasn't entered complete,
-- accurate recipes for every item would immediately see its stock numbers
-- drift into nonsense — worse than no automation. Opt in once recipes are
-- actually trustworthy. Same "optional per café, off by default" precedent
-- as KOT printing (0027) and cash management (0030).
alter table cafes add column if not exists auto_deduct_stock boolean not null default false;

-- Adapter pattern, exactly like enqueue_kot_jobs (0027): a trigger on
-- order_items, NOT logic inside place_order/staff_place_order. The order
-- engine stays the single canonical path and stays unaware of inventory.
-- The whole body is wrapped so that ANY failure here — a missing recipe, a
-- deleted ingredient, anything — can never fail or roll back a real
-- customer's order. Selling food must never depend on stock bookkeeping.
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

      insert into inventory_transactions (cafe_id, item_id, delta, reason)
      values (v_cafe_id, v_r.inventory_item_id, -(v_r.qty * new.qty),
              'Auto: order item ' || new.name);
    end loop;
  exception when others then
    -- Swallowed on purpose. Stock accounting is never allowed to break an order.
    null;
  end;
  return new;
end $$;

drop trigger if exists trg_deduct_stock_for_order_item on order_items;
create trigger trg_deduct_stock_for_order_item
  after insert on order_items
  for each row execute function deduct_stock_for_order_item();
