-- ============================================================================
-- 0196 — Reports-module audit, MEDIUM-severity fixes, part 2 of 2.
--
-- Profitability's cost model never distinguished real recipe/inventory-based
-- COGS (cost_source='recipe') from a flat manual estimate (cost_source=
-- 'manual') — both rendered identically as a plain "cost" with has_cost=
-- true, even though one is precise and the other an owner-entered guess.
-- order_items only ever snapshotted the computed cost NUMBER
-- (cost_snapshot), never which of the two methods produced it, so there was
-- no way to recover this for a historical line. New cost_source_snapshot
-- column, populated by the same trigger that already freezes cost_snapshot
-- at order time (0140's snapshot_order_item_tax) — additive, existing rows
-- simply have it null ("unknown", the honest answer for data that predates
-- this column).
-- ============================================================================

alter table order_items add column if not exists cost_source_snapshot text
  check (cost_source_snapshot is null or cost_source_snapshot in ('manual', 'recipe'));

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

  if new.cost_snapshot is null and new.menu_item_id is not null then
    new.cost_snapshot := menu_item_effective_cost_internal(new.menu_item_id, new.variant_id);
  end if;
  if new.cost_source_snapshot is null and new.menu_item_id is not null then
    select cost_source into new.cost_source_snapshot from menu_items where id = new.menu_item_id;
  end if;

  return new;
end $$;
-- Trigger definition unchanged (0037); the replaced function body is picked up.

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
  if not cafe_has_feature(p_cafe_id, 'advanced_reports') then
    raise exception 'advanced reports are not available on this café''s plan';
  end if;

  with lines as (
    select
      oi.menu_item_id, oi.name, oi.qty,
      coalesce((
        select sum(ri.qty) from refund_items ri
        join refunds r on r.id = ri.refund_id
        where ri.order_item_id = oi.id and r.status = 'completed'
      ), 0) as refunded_qty,
      coalesce(oi.taxable_value, oi.price * oi.qty) as line_taxable,
      coalesce(oi.cost_snapshot, 0) as unit_cost,
      (oi.cost_snapshot is not null) as costed,
      coalesce(oi.cost_source_snapshot, 'unknown') as cost_source
    from order_items oi
    join orders o on o.id = oi.order_id
    where o.cafe_id = p_cafe_id
      and o.created_at >= p_from and o.created_at < p_to
      and o.status <> 'cancelled'
      and (p_type = 'all' or o.type::text = p_type)
  ),
  net as (
    select menu_item_id, name, (qty - refunded_qty) as net_qty,
      case when qty > 0 then round(line_taxable * (qty - refunded_qty)::numeric / qty) else 0 end as net_sales,
      unit_cost * (qty - refunded_qty) as cost, costed, cost_source
    from lines
    where (qty - refunded_qty) > 0
  ),
  agg as (
    select menu_item_id, coalesce(name, '(removed item)') as name,
      sum(net_qty)::integer as qty, sum(net_sales)::integer as sales,
      sum(cost)::integer as cost, bool_and(costed) as has_cost,
      -- 'recipe' only when EVERY costed line this period used the recipe
      -- method, 'manual' only when every one was a flat estimate, else
      -- 'mixed' (covers a genuine method change mid-period, or historical
      -- lines from before cost_source_snapshot existed).
      case
        when not bool_and(costed) then null
        when bool_and(cost_source = 'recipe') then 'recipe'
        when bool_and(cost_source = 'manual') then 'manual'
        else 'mixed'
      end as cost_source
    from net
    group by menu_item_id, coalesce(name, '(removed item)')
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'net_sales',      coalesce((select sum(sales) from agg), 0),
      'cost',           coalesce((select sum(cost) from agg where has_cost), 0),
      'contribution',   coalesce((select sum(sales - cost) from agg where has_cost), 0),
      'margin_pct',     case when coalesce((select sum(sales) from agg where has_cost), 0) > 0
                            then round((select sum(sales - cost) from agg where has_cost) * 100.0 / (select sum(sales) from agg where has_cost), 1)
                            else 0 end,
      'uncosted_sales', coalesce((select sum(sales) from agg where not has_cost), 0)
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'menu_item_id', menu_item_id, 'name', name, 'qty', qty, 'sales', sales, 'cost', cost,
        'contribution', sales - cost,
        'margin_pct', case when sales > 0 then round((sales - cost) * 100.0 / sales, 1) else 0 end,
        'has_cost', has_cost,
        'cost_source', cost_source
      ) order by (sales - cost) desc)
      from agg), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'order_items' and column_name = 'cost_source_snapshot'
  ) then
    raise exception 'order_items.cost_source_snapshot missing';
  end if;
  if (select count(*) from pg_proc where proname = 'snapshot_order_item_tax') <> 1 then
    raise exception 'snapshot_order_item_tax: expected exactly one overload';
  end if;
  if (select count(*) from pg_proc where proname = 'profitability_report') <> 1 then
    raise exception 'profitability_report: expected exactly one overload';
  end if;
end $$;
