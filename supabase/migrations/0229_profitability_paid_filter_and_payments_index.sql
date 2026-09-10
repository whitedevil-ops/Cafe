-- ============================================================================
-- 0229 — two independent fixes from the full-product audit (2026-09-10):
--
-- 1. profitability_report never filtered on payment_status, unlike its
--    sibling sales_report/items_categories_report (both add
--    `payment_status in ('paid','refunded')`, explained in 0193's own
--    header: an unpaid order "still counted in every headline figure...
--    for what should be the same underlying question — what did we
--    actually sell"). A dine-in order can be status='completed' and still
--    payment_status='unpaid'/'partial' for as long as its table hasn't
--    settled the bill — profitability_report was counting that order's
--    full net_sales/cost/contribution as if it were already sold, inflating
--    the numbers for any café with open, unpaid tables.
--
-- 2. Live Tables' floor board queries `payments` on session_id/order_id
--    (app/dashboard/tables/floor-client.tsx's poll(), run every 4s per open
--    tab plus on 5 realtime triggers) with no supporting index — the only
--    indexes ever created on this table are the baseline (cafe_id,
--    order_id) composite and a unique index on (provider,
--    provider_payment_id), neither of which serves a session_id lookup or
--    an order_id-only lookup without a cafe_id predicate.
--
-- RUNNER NOTE, same reason as 0200's own — CREATE INDEX CONCURRENTLY cannot
-- run inside a transaction block, and pasting multiple statements into the
-- SQL Editor at once runs them as one implicit transaction. This file is
-- THREE separate submissions, run in this order:
--   Part 1 — the profitability_report fix (a normal, single paste)
--   Part 2 — the two index statements, EACH ITS OWN SEPARATE SUBMISSION
--   Part 3 — the self-check (a normal, single paste, after Part 2 finishes)
-- ============================================================================

-- ── PART 1 — paste and run this block by itself ─────────────────────────────

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
      -- 0229: matches sales_report/items_categories_report's own filter —
      -- an unpaid/partially-paid order is not yet a finalised sale.
      and o.payment_status in ('paid', 'refunded')
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

-- ── PART 2 — run EACH of these two statements as its OWN separate
--    submission (not together, not with anything else in this file) ───────

-- create index concurrently if not exists payments_session_id_idx
--   on payments (session_id) where session_id is not null;

-- create index concurrently if not exists payments_order_id_idx
--   on payments (order_id) where order_id is not null;

-- ── PART 3 — paste and run this block by itself, after Part 2 finishes ─────

-- do $$
-- declare v_src text;
-- begin
--   select pg_get_functiondef(p.oid) into v_src
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'profitability_report';
--   if v_src is null then raise exception 'profitability_report does not exist'; end if;
--   if v_src !~ 'payment_status in \(''paid'', ''refunded''\)' then
--     raise exception 'profitability_report is not filtering on payment_status';
--   end if;
--
--   if not exists (select 1 from pg_indexes where indexname = 'payments_session_id_idx') then
--     raise exception 'payments_session_id_idx was not created';
--   end if;
--   if not exists (select 1 from pg_indexes where indexname = 'payments_order_id_idx') then
--     raise exception 'payments_order_id_idx was not created';
--   end if;
-- end $$;
