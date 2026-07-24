-- ============================================================================
-- 0052 — Item cost, contribution & a per-order cost SNAPSHOT.
--
-- Terminology is deliberate (spec): we track Estimated Cost, Gross Contribution
-- and Contribution Margin — NOT "net profit", because rent/salaries/utilities
-- are not included.
--
-- Two cost sources, per item:
--   'manual' — an owner-entered estimated unit cost (works without inventory).
--   'recipe' — computed from recipe_items × inventory_items.cost (0036).
-- 0036 deliberately did NOT store recipe cost on menu_items (derived value that
-- would drift). We keep that: 'recipe' items are still computed on read. The new
-- `cost` column only holds the MANUAL figure.
--
-- HISTORICAL SNAPSHOT: the effective unit cost is frozen onto each order line at
-- sale time (order_items.cost_snapshot), via the SAME before-insert trigger that
-- already snapshots tax. So when a menu cost changes next month, past bills and
-- past profitability do not silently rewrite.
-- ============================================================================

-- 1. Manual estimated cost + which source an item uses.
alter table menu_items add column if not exists cost integer check (cost is null or cost >= 0);
alter table menu_items add column if not exists cost_source text not null default 'manual'
  check (cost_source in ('manual', 'recipe'));

-- 2. The frozen unit cost on each sold line.
alter table order_items add column if not exists cost_snapshot integer;

-- 3. An item's effective unit cost RIGHT NOW.
create or replace function menu_item_effective_cost(p_menu_item_id uuid)
returns integer language plpgsql stable security definer set search_path = public as $$
declare v_src text; v_manual integer; v_recipe numeric;
begin
  select cost_source, cost into v_src, v_manual from menu_items where id = p_menu_item_id;
  if not found then return 0; end if;

  if v_src = 'recipe' then
    select coalesce(round(sum(ri.qty * coalesce(inv.cost, 0))), 0) into v_recipe
      from recipe_items ri
      join inventory_items inv on inv.id = ri.inventory_item_id
     where ri.menu_item_id = p_menu_item_id;
    return coalesce(v_recipe, 0)::integer;
  end if;

  return coalesce(v_manual, 0);
end $$;
revoke execute on function menu_item_effective_cost(uuid) from public, anon;
grant execute on function menu_item_effective_cost(uuid) to authenticated;

-- 4. Extend the line snapshot trigger to also freeze cost_snapshot.
--    Each field is now independently null-guarded (the old combined early-return
--    would have skipped cost whenever tax + hsn were already set).
create or replace function snapshot_order_item_tax() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_cafe_id uuid;
begin
  select o.cafe_id into v_cafe_id from orders o where o.id = new.order_id;
  if v_cafe_id is null then return new; end if;

  if new.tax_percent is null then
    select coalesce(mi.tax_percent, c.tax_percent) into new.tax_percent
      from cafes c left join menu_items mi on mi.id = new.menu_item_id
     where c.id = v_cafe_id;
  end if;

  if new.hsn_sac is null then
    select coalesce(mi.hsn_sac, c.gst_sac_code) into new.hsn_sac
      from cafes c left join menu_items mi on mi.id = new.menu_item_id
     where c.id = v_cafe_id;
  end if;

  -- Freeze the estimated unit cost at sale time (historical stability).
  if new.cost_snapshot is null and new.menu_item_id is not null then
    new.cost_snapshot := menu_item_effective_cost(new.menu_item_id);
  end if;

  return new;
end $$;
-- Trigger definition unchanged (0037); the replaced function body is picked up.

-- 5. Profitability report — OWNER/MANAGER ONLY, from ACTUAL finalized orders.
--
-- METHODOLOGY (documented):
--   * Source rows: order_items of orders in [from,to), status <> 'cancelled'
--     (cancelled orders are never revenue), optional type filter.
--   * Net sales per line = the snapshotted taxable_value (post-discount,
--     tax-EXCLUDED — apply_order_taxes already folded the proportional discount
--     in), prorated to the quantity that was NOT refunded. Falls back to
--     price×qty for pre-GST-era lines with no taxable_value.
--   * Refunds: a line's refunded quantity (from completed refunds) is removed
--     from both sales and cost, so a refunded item contributes nothing.
--   * Cost = frozen cost_snapshot × net quantity. Lines predating this feature
--     have no snapshot (treated as 0 and flagged via has_cost=false).
--   * Contribution = net sales − cost. Margin = contribution / net sales.
create or replace function profitability_report(
  p_cafe_id uuid,
  p_from    timestamptz,
  p_to      timestamptz,
  p_type    text default 'all'
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not has_cafe_role(p_cafe_id, array['owner','manager']::member_role[]) then
    raise exception 'only an owner or manager can view profitability';
  end if;

  with lines as (
    select
      oi.menu_item_id,
      oi.name,
      oi.qty,
      coalesce((
        select sum(ri.qty) from refund_items ri
        join refunds r on r.id = ri.refund_id
        where ri.order_item_id = oi.id and r.status = 'completed'
      ), 0) as refunded_qty,
      coalesce(oi.taxable_value, oi.price * oi.qty) as line_taxable,
      coalesce(oi.cost_snapshot, 0) as unit_cost,
      (oi.cost_snapshot is not null) as costed
    from order_items oi
    join orders o on o.id = oi.order_id
    where o.cafe_id = p_cafe_id
      and o.created_at >= p_from and o.created_at < p_to
      and o.status <> 'cancelled'
      and (p_type = 'all' or o.type::text = p_type)
  ),
  net as (
    select
      menu_item_id,
      name,
      (qty - refunded_qty) as net_qty,
      case when qty > 0 then round(line_taxable * (qty - refunded_qty)::numeric / qty) else 0 end as net_sales,
      unit_cost * (qty - refunded_qty) as cost,
      costed
    from lines
    where (qty - refunded_qty) > 0
  ),
  agg as (
    select
      menu_item_id,
      coalesce(name, '(removed item)') as name,
      sum(net_qty)::integer as qty,
      sum(net_sales)::integer as sales,
      sum(cost)::integer as cost,
      bool_and(costed) as has_cost
    from net
    group by menu_item_id, coalesce(name, '(removed item)')
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'net_sales',    coalesce((select sum(sales) from agg), 0),
      'cost',         coalesce((select sum(cost) from agg), 0),
      'contribution', coalesce((select sum(sales - cost) from agg), 0),
      'margin_pct',   case when coalesce((select sum(sales) from agg), 0) > 0
                          then round((select sum(sales - cost) from agg) * 100.0 / (select sum(sales) from agg), 1)
                          else 0 end
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'menu_item_id', menu_item_id,
        'name', name,
        'qty', qty,
        'sales', sales,
        'cost', cost,
        'contribution', sales - cost,
        'margin_pct', case when sales > 0 then round((sales - cost) * 100.0 / sales, 1) else 0 end,
        'has_cost', has_cost
      ) order by (sales - cost) desc)
      from agg), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;
revoke execute on function profitability_report(uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function profitability_report(uuid, timestamptz, timestamptz, text) to authenticated;
