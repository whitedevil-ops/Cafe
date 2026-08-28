-- ============================================================================
-- Phase 1 security lockdown, part 4 — 6 premium features (crm, inventory,
-- expenses, feedback, advanced_analytics, advanced_reports) were entitlement-
-- gated only by the Next.js page-level hasFeature() redirect; the RPCs/RLS
-- behind them never re-checked cafe_has_feature(), so any authenticated
-- staff member's own session could reach the data directly (supabase-js or
-- curl) regardless of plan or an ops admin's Feature Control override — the
-- exact bypass class already closed for coupons/loyalty/spin in 0143.
--
-- Every change here was verified against a full read of current callers
-- before being written, specifically to avoid the "gate a shared table used
-- by something else" mistake. Two places that pattern actually applied are
-- called out explicitly below (gst_invoice_report/adjustments_report, both
-- also legitimately used by the base-plan Day Close report).
-- ============================================================================

-- ── 1. crm: app/dashboard/customers (v_customer_stats + update_customer_name) ─
--
-- v_customer_stats is security_invoker and had no entitlement filter of its
-- own — a staff member on any plan could `.from('v_customer_stats').select()`
-- directly. Also silently fixes the SAME gap in the home dashboard's
-- "at-risk customers" widget (dashboard-client.tsx/page.tsx), which already
-- fetches this view unconditionally and only discards the result in JS.
-- Re-bodied from its 0088 definition, byte-for-byte identical plus one WHERE
-- clause on the final select.
create or replace view v_customer_stats
with (security_invoker = true) as
with order_stats as (
  select
    o.cafe_id,
    o.customer_id,
    count(distinct coalesce(o.session_id, o.id)) filter (where o.status = 'completed') as visits,
    coalesce(sum(o.total) filter (where o.status = 'completed'), 0)                    as total_spend,
    max(o.created_at) filter (where o.status = 'completed')                            as last_visit
  from orders o
  where o.customer_id is not null
  group by o.cafe_id, o.customer_id
),
item_counts as (
  select o.cafe_id, o.customer_id, oi.name, sum(oi.qty) as qty
  from orders o
  join order_items oi on oi.order_id = o.id
  where o.customer_id is not null and o.status = 'completed'
  group by o.cafe_id, o.customer_id, oi.name
),
favourite as (
  select distinct on (cafe_id, customer_id) cafe_id, customer_id, name as favourite_item
  from item_counts
  order by cafe_id, customer_id, qty desc, name
),
spend_rank as (
  select cafe_id, customer_id,
         percent_rank() over (partition by cafe_id order by total_spend) as spend_pctile
  from order_stats
  where visits > 0
)
select
  c.id                              as customer_id,
  c.cafe_id,
  c.name,
  c.phone,
  c.email,
  coalesce(os.visits, 0)            as visits,
  coalesce(os.total_spend, 0)       as total_spend,
  case when coalesce(os.visits, 0) > 0
       then round(os.total_spend::numeric / os.visits) else 0 end as avg_order_value,
  os.last_visit,
  f.favourite_item,
  coalesce(lb.balance, 0)           as loyalty_points,
  case
    when coalesce(os.visits, 0) >= 2 and os.last_visit < now() - interval '30 days' then 'at_risk'
    when coalesce(os.visits, 0) >= 3 and coalesce(sr.spend_pctile, 0) >= 0.9 then 'vip'
    when coalesce(os.visits, 0) <= 1 then 'new'
    else 'regular'
  end as segment,
  exists(
    select 1 from customer_devices cd
    where cd.cafe_id = c.cafe_id and cd.customer_id = c.id and cd.status = 'active'
  )                                 as has_trusted_device
from customers c
left join order_stats os on os.cafe_id = c.cafe_id and os.customer_id = c.id
left join favourite    f on f.cafe_id = c.cafe_id and f.customer_id = c.id
left join spend_rank   sr on sr.cafe_id = c.cafe_id and sr.customer_id = c.id
left join loyalty_accounts la on la.cafe_id = c.cafe_id and la.customer_id = c.id
left join v_loyalty_balance lb on lb.account_id = la.id
where cafe_has_feature(c.cafe_id, 'crm');

create or replace function update_customer_name(p_customer_id uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id uuid;
  v_before  text;
  v_after   text;
begin
  select cafe_id, name into v_cafe_id, v_before from customers where id = p_customer_id;
  if v_cafe_id is null then raise exception 'customer not found'; end if;
  if not is_cafe_member(v_cafe_id) then raise exception 'not authorized'; end if;
  if not cafe_has_feature(v_cafe_id, 'crm') then
    raise exception 'the customer directory is not available on this café''s plan';
  end if;

  v_after := nullif(trim(p_name), '');
  update customers set name = v_after where id = p_customer_id;

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (v_cafe_id, auth.uid(), 'customer.name_updated', 'customers', p_customer_id,
          jsonb_build_object('previous_name', v_before, 'name', v_after));
end $$;

-- ── 2. inventory: record_inventory_movement + create_purchase_order ─────────
-- Order placement/completion (auto_deduct_stock) writes to inventory_items/
-- inventory_transactions directly via a trigger and never calls either RPC —
-- confirmed by tracing every re-body of deduct_stock_for_order_item and
-- reverse_stock_for_cancelled_order. Gating these two RPCs cannot affect
-- order placement, KOT, or cancellation on any plan.
create or replace function record_inventory_movement(
  p_cafe_id uuid,
  p_item_id uuid,
  p_delta   numeric,
  p_reason  text
) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_new_stock numeric;
begin
  if not is_cafe_member(p_cafe_id) then
    raise exception 'not authorized';
  end if;
  if not cafe_has_feature(p_cafe_id, 'inventory') then
    raise exception 'inventory is not available on this café''s plan';
  end if;
  if p_delta = 0 then
    raise exception 'delta must be non-zero';
  end if;
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'a reason is required for every stock movement';
  end if;

  update inventory_items
    set current_stock = current_stock + p_delta
    where id = p_item_id and cafe_id = p_cafe_id
    returning current_stock into v_new_stock;

  if v_new_stock is null then
    raise exception 'inventory item not found for this café';
  end if;

  insert into inventory_transactions (cafe_id, item_id, delta, reason)
  values (p_cafe_id, p_item_id, p_delta, p_reason);

  return v_new_stock;
end $$;

create or replace function create_purchase_order(
  p_cafe_id       uuid,
  p_supplier_id   uuid,
  p_items         jsonb,
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
  if not cafe_has_feature(p_cafe_id, 'inventory') then
    raise exception 'inventory is not available on this café''s plan';
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

-- ── 3. expenses: RLS read + record_expense/delete_expense ───────────────────
-- 0034's "member all" policy is stale/historical — 0050 already tightened
-- expenses to read-only RLS + these two RPCs for writes; neither the policy
-- nor the RPCs ever checked cafe_has_feature('expenses'). sales_report()
-- reads expenses too but is SECURITY DEFINER (bypasses RLS entirely) and
-- belongs to the separate 'advanced_reports' feature by design — untouched.
drop policy if exists "member read" on expenses;
create policy "member read" on expenses
  for select using (is_cafe_member(cafe_id) and cafe_has_feature(cafe_id, 'expenses'));

create or replace function record_expense(
  p_cafe_id  uuid,
  p_category text,
  p_amount   integer,
  p_vendor   text default null,
  p_method   text default null,
  p_notes    text default null,
  p_spent_on date default current_date
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_cat text;
begin
  if not has_cafe_role(p_cafe_id, array['owner','manager']::member_role[]) then
    raise exception 'only an owner or manager can record expenses';
  end if;
  if not cafe_has_feature(p_cafe_id, 'expenses') then
    raise exception 'expenses are not available on this café''s plan';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be greater than zero';
  end if;
  v_cat := nullif(trim(coalesce(p_category, '')), '');
  if v_cat is null then raise exception 'category is required'; end if;

  insert into expenses (cafe_id, category, amount, vendor, method, notes, spent_on)
  values (p_cafe_id, v_cat, p_amount,
          nullif(trim(coalesce(p_vendor, '')), ''),
          nullif(trim(coalesce(p_method, '')), ''),
          nullif(trim(coalesce(p_notes, '')), ''),
          coalesce(p_spent_on, current_date))
  returning id into v_id;

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (p_cafe_id, auth.uid(), 'expense.recorded', 'expenses', v_id,
          jsonb_build_object('amount', p_amount, 'category', v_cat));

  return (select to_jsonb(e) from expenses e where e.id = v_id);
end $$;

create or replace function delete_expense(p_expense_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_cafe uuid; v_amount integer;
begin
  select cafe_id, amount into v_cafe, v_amount from expenses where id = p_expense_id;
  if v_cafe is null then raise exception 'expense not found'; end if;
  if not has_cafe_role(v_cafe, array['owner','manager']::member_role[]) then
    raise exception 'only an owner or manager can delete an expense';
  end if;
  if not cafe_has_feature(v_cafe, 'expenses') then
    raise exception 'expenses are not available on this café''s plan';
  end if;

  delete from expenses where id = p_expense_id;

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (v_cafe, auth.uid(), 'expense.deleted', 'expenses', p_expense_id,
          jsonb_build_object('amount', v_amount));
end $$;

-- ── 4. feedback: feedback_summary() + table RLS ──────────────────────────────
-- submit_feedback() (anon, data collection) is untouched — this is the
-- owner-facing analytics RPC/read only. Only caller of either is the
-- feedback dashboard page itself, confirmed by exhaustive grep.
create or replace function feedback_summary(p_cafe_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not is_cafe_member(p_cafe_id) then raise exception 'not authorized'; end if;
  if not cafe_has_feature(p_cafe_id, 'feedback') then
    raise exception 'feedback is not available on this café''s plan';
  end if;

  select jsonb_build_object(
    'count', count(*),
    'avg_rating', coalesce(round(avg(rating)::numeric, 2), 0),
    'by_star', jsonb_build_object(
      '5', count(*) filter (where rating = 5),
      '4', count(*) filter (where rating = 4),
      '3', count(*) filter (where rating = 3),
      '2', count(*) filter (where rating = 2),
      '1', count(*) filter (where rating = 1)
    )
  ) into v_result
  from feedback
  where cafe_id = p_cafe_id and created_at >= p_from and created_at < p_to;

  return v_result;
end $$;

drop policy if exists "member read" on feedback;
create policy "member read" on feedback for select
  using (is_cafe_member(cafe_id) and cafe_has_feature(cafe_id, 'feedback'));

-- ── 5. advanced_analytics: advanced_analytics_report() ───────────────────────
-- Single caller (its own page + client-side date-range refetch), no shared
-- table/RPC risk.
create or replace function advanced_analytics_report(p_cafe_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
  v_tz     text;
begin
  if not is_cafe_member(p_cafe_id) then raise exception 'not authorized'; end if;
  if not cafe_has_feature(p_cafe_id, 'advanced_analytics') then
    raise exception 'advanced analytics is not available on this café''s plan';
  end if;
  if p_to <= p_from then raise exception 'invalid range'; end if;

  select coalesce(timezone, 'Asia/Kolkata') into v_tz from cafes where id = p_cafe_id;

  with orders_in_range as (
    select o.* from orders o
    where o.cafe_id = p_cafe_id and o.status <> 'cancelled'
      and o.created_at >= p_from and o.created_at < p_to
  ),
  daily as (
    select (created_at at time zone v_tz)::date as d, sum(total) as revenue, count(*) as orders
    from orders_in_range group by 1
  ),
  daily_json as (
    select coalesce(jsonb_agg(jsonb_build_object('date', d, 'revenue', revenue, 'orders', orders) order by d), '[]'::jsonb) as arr
    from daily
  ),
  hourly as (
    select extract(dow from created_at at time zone v_tz)::int as dow,
           extract(hour from created_at at time zone v_tz)::int as hr,
           sum(total) as revenue, count(*) as orders
    from orders_in_range group by 1, 2
  ),
  hourly_json as (
    select coalesce(jsonb_agg(jsonb_build_object('dow', dow, 'hour', hr, 'revenue', revenue, 'orders', orders)), '[]'::jsonb) as arr
    from hourly
  ),
  customer_orders as (
    select customer_id, count(*) as cnt from orders_in_range where customer_id is not null group by 1
  ),
  repeat_stats as (
    select count(*) filter (where cnt = 1) as new_customers, count(*) filter (where cnt > 1) as returning_customers
    from customer_orders
  ),
  recent_avg as (
    select coalesce(avg(revenue), 0) as avg_daily from daily where d >= (p_to::date - 7)
  )
  select jsonb_build_object(
    'daily_revenue', (select arr from daily_json),
    'hourly_heatmap', (select arr from hourly_json),
    'repeat', jsonb_build_object(
      'new_customers', coalesce((select new_customers from repeat_stats), 0),
      'returning_customers', coalesce((select returning_customers from repeat_stats), 0),
      'repeat_rate_pct', case when coalesce((select new_customers + returning_customers from repeat_stats), 0) > 0
        then round(100.0 * (select returning_customers from repeat_stats) / (select new_customers + returning_customers from repeat_stats), 1)
        else 0 end
    ),
    'forecast_next_7d', round((select avg_daily from recent_avg) * 7)
  ) into v_result;

  return v_result;
end $$;

-- ── 6. advanced_reports: profitability_report + operations_report gated
--    directly (single caller each); gst_invoice_report/adjustments_report
--    are ALSO used by Day Close (base-plan, every tier — confirmed against
--    app/pricing/page.tsx's "On every plan, including the cheapest" section)
--    so gating them directly would break Day Close for every Starter/Growth
--    café. Left untouched; new _premium wrapper RPCs are the only entry
--    point the two premium standalone report pages should call instead
--    (app-code change below). Residual, deliberately-not-closed-here gap:
--    the raw gst_invoice_report/adjustments_report RPCs remain callable
--    directly with an arbitrary date range on any plan, same as before —
--    fully closing that means teaching those RPCs to distinguish Day
--    Close's "today only" usage from a wide-range premium report, a bigger
--    change than "add the missing check" and a product decision, not made
--    here.
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
      (oi.cost_snapshot is not null) as costed
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
      unit_cost * (qty - refunded_qty) as cost, costed
    from lines
    where (qty - refunded_qty) > 0
  ),
  agg as (
    select menu_item_id, coalesce(name, '(removed item)') as name,
      sum(net_qty)::integer as qty, sum(net_sales)::integer as sales,
      sum(cost)::integer as cost, bool_and(costed) as has_cost
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
        'menu_item_id', menu_item_id, 'name', name, 'qty', qty, 'sales', sales, 'cost', cost,
        'contribution', sales - cost,
        'margin_pct', case when sales > 0 then round((sales - cost) * 100.0 / sales, 1) else 0 end,
        'has_cost', has_cost
      ) order by (sales - cost) desc)
      from agg), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;

create or replace function operations_report(
  p_cafe_id uuid, p_from timestamptz, p_to timestamptz
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not is_cafe_member(p_cafe_id) then raise exception 'not authorized'; end if;
  if not cafe_has_feature(p_cafe_id, 'advanced_reports') then
    raise exception 'advanced reports are not available on this café''s plan';
  end if;
  if p_to <= p_from then raise exception 'invalid range'; end if;

  with completed as (
    select o.id, extract(epoch from (o.done_at - o.created_at)) / 60 as mins
    from orders o
    where o.cafe_id = p_cafe_id and o.status = 'completed' and o.done_at is not null
      and o.created_at >= p_from and o.created_at < p_to
  ),
  turnaround_summary as (
    select
      coalesce(round(avg(mins)), 0) as avg_mins,
      coalesce(round((percentile_cont(0.5) within group (order by mins))::numeric), 0) as median_mins,
      count(*) as cnt
    from completed
  ),
  turnaround_buckets as (
    select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket, 'orders', cnt) order by ord), '[]'::jsonb) as arr
    from (
      select
        case when mins < 10 then 'Under 10 min' when mins < 20 then '10–20 min'
             when mins < 30 then '20–30 min' else 'Over 30 min' end as bucket,
        case when mins < 10 then 0 when mins < 20 then 1 when mins < 30 then 2 else 3 end as ord,
        count(*) as cnt
      from completed
      group by 1, 2
    ) x
  ),
  sessions as (
    select ts.id, extract(epoch from (ts.closed_at - ts.started_at)) / 60 as mins
    from table_sessions ts
    where ts.cafe_id = p_cafe_id and ts.closed_at is not null
      and ts.started_at >= p_from and ts.started_at < p_to
  ),
  turnover_summary as (
    select coalesce(round(avg(mins)), 0) as avg_mins, count(*) as cnt from sessions
  ),
  cancelled as (
    select count(*) as cnt from orders
    where cafe_id = p_cafe_id and status = 'cancelled'
      and created_at >= p_from and created_at < p_to
  )
  select jsonb_build_object(
    'turnaround', jsonb_build_object(
      'avg_mins', (select avg_mins from turnaround_summary),
      'median_mins', (select median_mins from turnaround_summary),
      'completed_orders', (select cnt from turnaround_summary),
      'buckets', (select arr from turnaround_buckets)
    ),
    'table_turnover', jsonb_build_object(
      'avg_mins', (select avg_mins from turnover_summary),
      'sessions', (select cnt from turnover_summary)
    ),
    'cancelled_orders', (select cnt from cancelled)
  ) into v_result;

  return v_result;
end $$;

-- New premium-only wrappers — gst_invoice_report/adjustments_report
-- themselves are intentionally untouched (Day Close needs them ungated).
create or replace function gst_invoice_report_premium(
  p_cafe_id uuid, p_from timestamptz, p_to timestamptz
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_cafe_member(p_cafe_id) then raise exception 'not authorized'; end if;
  if not cafe_has_feature(p_cafe_id, 'advanced_reports') then
    raise exception 'advanced reports are not available on this café''s plan';
  end if;
  return gst_invoice_report(p_cafe_id, p_from, p_to);
end $$;

create or replace function adjustments_report_premium(
  p_cafe_id uuid, p_from timestamptz, p_to timestamptz
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_cafe_member(p_cafe_id) then raise exception 'not authorized'; end if;
  if not cafe_has_feature(p_cafe_id, 'advanced_reports') then
    raise exception 'advanced reports are not available on this café''s plan';
  end if;
  return adjustments_report(p_cafe_id, p_from, p_to);
end $$;

revoke execute on function gst_invoice_report_premium(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function gst_invoice_report_premium(uuid, timestamptz, timestamptz) to authenticated;
revoke execute on function adjustments_report_premium(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function adjustments_report_premium(uuid, timestamptz, timestamptz) to authenticated;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_proc where proname = 'gst_invoice_report_premium') <> 1 then
    raise exception 'gst_invoice_report_premium: expected exactly one overload';
  end if;
  if (select count(*) from pg_proc where proname = 'adjustments_report_premium') <> 1 then
    raise exception 'adjustments_report_premium: expected exactly one overload';
  end if;
end $$;
