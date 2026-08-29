-- ============================================================================
-- 0193 — Reports-module audit, HIGH-severity fixes, part 1 of 2. All five
-- functions below are pure re-bodies — no signature changes.
--
-- 1. payments_outstanding_report's `collected`/`by_method` CTEs summed EVERY
--    payment row with no `order_id is not null` guard — the exact orphan-
--    payment bug already fixed in outstanding_summary (0186) and
--    business_overview_report (0192), independently present here too.
--
-- 2. sales_report's `expenses`/`net_profit` were returned to ANY café member
--    regardless of role — Day Close's own UI hides these two figures from
--    non-owner/manager staff (day-close-client.tsx's `canSeeProfit` gate),
--    but the RPC itself never enforced it, so a waiter's own session could
--    read the real numbers via a direct RPC call. The Sales Report page's
--    own UI didn't even attempt to hide them (sales-report-client.tsx
--    rendered both unconditionally) — fixed at the source here; both
--    frontends are updated separately to gate on `null` gracefully.
--
-- 3. items_categories_report had no payment_status filter at all — an unpaid
--    (never collected) order still counted in every headline figure, unlike
--    sales_report's own `payment_status in ('paid','refunded')` filter for
--    what should be the same underlying question ("what did we actually
--    sell"). Same fix applied to advanced_analytics_report (4).
--
-- 5. business_overview_report's by_day/by_hour breakdowns summed the full
--    tax-INCLUSIVE order total, while the headline "Net Sales" KPI directly
--    above the by-day chart is tax-EXCLUSIVE (gross_sales − discounts −
--    refunds) — live-confirmed a single order rendering ₹315 in the chart
--    against ₹200 in the headline for the exact same period. Now tax-
--    exclusive and discount-netted per order, matching the headline's basis.
--    Deliberately NOT refund-netted per day: refunds_now is scoped by the
--    REFUND's own timestamp, not the original order's day, so there is no
--    single fair day to attribute one to without redefining the headline's
--    own accrual/cash-basis mix — the frontend relabels this chart from
--    "Net sales" to "Sales" so it no longer overclaims full parity with the
--    headline figure. `by_day`'s JSON key renamed net_sales -> sales to
--    match by_hour's existing, more honest naming.
-- ============================================================================

create or replace function payments_outstanding_report(
  p_cafe_id uuid, p_from timestamptz, p_to timestamptz
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not is_cafe_member(p_cafe_id) then raise exception 'not authorized'; end if;
  if p_to <= p_from then raise exception 'invalid range'; end if;

  with collected as (
    select coalesce(sum(amount), 0) as amt, count(*) as cnt
    from payments where cafe_id = p_cafe_id and order_id is not null
      and created_at >= p_from and created_at < p_to
  ),
  by_method_json as (
    select coalesce(jsonb_agg(jsonb_build_object('method', method, 'amount', amt, 'transactions', cnt) order by amt desc), '[]'::jsonb) as arr
    from (
      select method::text as method, sum(amount) as amt, count(*) as cnt
      from payments where cafe_id = p_cafe_id and order_id is not null
        and created_at >= p_from and created_at < p_to
      group by 1
    ) x
  ),
  outstanding_orders as (
    select o.id, o.short_code, o.type, o.total, o.created_at,
           coalesce((select sum(amount) from payments p where p.order_id = o.id), 0) as paid
    from orders o
    where o.cafe_id = p_cafe_id and o.status <> 'cancelled'
      and o.created_at >= p_from and o.created_at < p_to
      and o.total > coalesce((select sum(amount) from payments p where p.order_id = o.id), 0)
  ),
  aging_json as (
    select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket, 'amount', amt, 'orders', cnt) order by ord), '[]'::jsonb) as arr
    from (
      select
        case
          when now() - created_at < interval '1 day' then '0–1 day'
          when now() - created_at < interval '3 days' then '1–3 days'
          when now() - created_at < interval '7 days' then '3–7 days'
          else '7+ days'
        end as bucket,
        case
          when now() - created_at < interval '1 day' then 0
          when now() - created_at < interval '3 days' then 1
          when now() - created_at < interval '7 days' then 2
          else 3
        end as ord,
        sum(total - paid) as amt, count(*) as cnt
      from outstanding_orders
      group by 1, 2
    ) x
  ),
  bills_json as (
    select coalesce(jsonb_agg(x order by (x->>'created_at')::timestamptz asc), '[]'::jsonb) as arr
    from (
      select jsonb_build_object(
        'order_id', id, 'short_code', short_code, 'type', type::text,
        'total', total, 'paid', paid, 'due', total - paid, 'created_at', created_at
      ) as x
      from outstanding_orders
      order by created_at asc
      limit 100
    ) y
  ),
  wallet_topups as (
    select
      coalesce(sum(paid_amount) filter (where source = 'cash'), 0) as cash_amt,
      coalesce(sum(paid_amount) filter (where source = 'online'), 0) as online_amt,
      count(*) filter (where source = 'cash') as cash_cnt,
      count(*) filter (where source = 'online') as online_cnt
    from wallet_transactions
    where cafe_id = p_cafe_id and kind = 'topup'
      and created_at >= p_from and created_at < p_to
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'collected', (select amt from collected),
      'collected_transactions', (select cnt from collected),
      'outstanding_amount', (select coalesce(sum(total - paid), 0) from outstanding_orders),
      'outstanding_orders', (select count(*) from outstanding_orders)
    ),
    'by_method', (select arr from by_method_json),
    'aging', (select arr from aging_json),
    'outstanding_bills', (select arr from bills_json),
    'wallet_topups', (select jsonb_build_object(
      'cash', cash_amt, 'online', online_amt, 'total', cash_amt + online_amt,
      'cash_transactions', cash_cnt, 'online_transactions', online_cnt, 'transactions', cash_cnt + online_cnt
    ) from wallet_topups)
  ) into v_result;

  return v_result;
end $$;

create or replace function sales_report(p_cafe_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_result   jsonb;
  v_tz       text;
  v_owner_ok boolean;
begin
  if not is_cafe_member(p_cafe_id) then
    raise exception 'not authorized';
  end if;

  select coalesce(timezone, 'Asia/Kolkata') into v_tz from cafes where id = p_cafe_id;
  v_owner_ok := has_cafe_role(p_cafe_id, array['owner','manager']::member_role[]);

  with base as (
    select o.*, coalesce(c.timezone, 'Asia/Kolkata') as cafe_tz
    from orders o
    join cafes c on c.id = o.cafe_id
    where o.cafe_id = p_cafe_id
      and o.status <> 'cancelled'
      and o.payment_status in ('paid', 'refunded')
      and o.created_at >= p_from and o.created_at < p_to
  ),
  refund_total as (
    select coalesce(sum(amount), 0) as total
    from refunds
    where cafe_id = p_cafe_id and status = 'completed'
      and created_at >= p_from and created_at < p_to
  ),
  expense_total as (
    select coalesce(sum(amount), 0) as total
    from expenses
    where cafe_id = p_cafe_id
      and spent_on >= (p_from at time zone v_tz)::date
      and spent_on <= ((p_to - interval '1 microsecond') at time zone v_tz)::date
  ),
  by_day as (
    select coalesce(jsonb_agg(jsonb_build_object('date', d, 'revenue', rev, 'orders', cnt) order by d), '[]'::jsonb) as arr
    from (
      select to_char(created_at at time zone cafe_tz, 'YYYY-MM-DD') as d,
             sum(total) as rev, count(*) as cnt
      from base
      group by 1
    ) t
  ),
  top_items as (
    select coalesce(jsonb_agg(jsonb_build_object('name', name, 'qty', qty, 'revenue', rev) order by rev desc), '[]'::jsonb) as arr
    from (
      select oi.name, sum(oi.qty) as qty, sum(oi.price * oi.qty) as rev
      from order_items oi
      join base b on b.id = oi.order_id
      group by oi.name
      order by rev desc
      limit 10
    ) t
  ),
  by_category as (
    select coalesce(jsonb_agg(jsonb_build_object('category', cat, 'revenue', rev) order by rev desc), '[]'::jsonb) as arr
    from (
      select coalesce(mc.name, 'Uncategorised') as cat, sum(oi.price * oi.qty) as rev
      from order_items oi
      join base b on b.id = oi.order_id
      left join menu_items mi on mi.id = oi.menu_item_id
      left join menu_categories mc on mc.id = mi.category_id
      group by 1
    ) t
  ),
  by_method as (
    select coalesce(jsonb_agg(jsonb_build_object('method', payment_method, 'revenue', rev) order by rev desc), '[]'::jsonb) as arr
    from (
      select payment_method, sum(total) as rev
      from base
      group by 1
    ) t
  ),
  by_source as (
    select coalesce(jsonb_agg(jsonb_build_object('source', source, 'orders', cnt, 'revenue', rev) order by rev desc), '[]'::jsonb) as arr
    from (
      select source, count(*) as cnt, sum(total) as rev
      from base
      group by 1
    ) t
  ),
  by_staff as (
    select coalesce(jsonb_agg(jsonb_build_object('staff_name', name, 'orders', cnt, 'revenue', rev) order by rev desc), '[]'::jsonb) as arr
    from (
      select coalesce(p.full_name, 'Unknown') as name, count(*) as cnt, sum(b.total) as rev
      from base b
      join profiles p on p.id = b.staff_id
      where b.staff_id is not null
      group by 1
    ) t
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'revenue',    coalesce((select sum(total) from base), 0),
      'orders',     (select count(*) from base),
      'aov',        case when (select count(*) from base) > 0
                      then round((select sum(total) from base)::numeric / (select count(*) from base))
                      else 0 end,
      'discount',   coalesce((select sum(discount) from base), 0),
      'tax',        coalesce((select sum(tax) from base), 0),
      'refunds',    (select total from refund_total),
      'expenses',   case when v_owner_ok then (select total from expense_total) else null end,
      'net_profit', case when v_owner_ok then
                      coalesce((select sum(total) from base), 0)
                      - (select total from refund_total)
                      - (select total from expense_total)
                    else null end
    ),
    'by_day',            (select arr from by_day),
    'top_items',         (select arr from top_items),
    'by_category',       (select arr from by_category),
    'by_payment_method', (select arr from by_method),
    'by_source',         (select arr from by_source),
    'by_staff',          (select arr from by_staff)
  ) into v_result;

  return v_result;
end $$;

create or replace function items_categories_report(
  p_cafe_id uuid, p_from timestamptz, p_to timestamptz
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not is_cafe_member(p_cafe_id) then raise exception 'not authorized'; end if;
  if p_to <= p_from then raise exception 'invalid range'; end if;

  with base as (
    select o.* from orders o
    where o.cafe_id = p_cafe_id and o.status <> 'cancelled'
      and o.payment_status in ('paid', 'refunded')
      and o.created_at >= p_from and o.created_at < p_to
  ),
  item_sales as (
    select oi.menu_item_id, oi.name,
           sum(oi.qty) as qty, sum(oi.price * oi.qty) as gross_sales,
           count(distinct oi.order_id) as orders
    from order_items oi join base b on b.id = oi.order_id
    group by oi.menu_item_id, oi.name
  ),
  total_gross as (select coalesce(sum(gross_sales), 0) as amt from item_sales),
  items_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'menu_item_id', menu_item_id, 'name', name, 'qty', qty,
      'gross_sales', gross_sales, 'orders', orders,
      'avg_price', case when qty > 0 then round(gross_sales::numeric / qty) else 0 end
    ) order by gross_sales desc), '[]'::jsonb) as arr
    from item_sales
  ),
  categories_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'category', cat, 'qty', qty, 'gross_sales', amt,
      'share_pct', case when (select amt from total_gross) > 0
        then round(amt::numeric * 100 / (select amt from total_gross), 1) else 0 end
    ) order by amt desc), '[]'::jsonb) as arr
    from (
      select coalesce(mc.name, 'Uncategorised') as cat, sum(oi.qty) as qty, sum(oi.price * oi.qty) as amt
      from order_items oi join base b on b.id = oi.order_id
      left join menu_items mi on mi.id = oi.menu_item_id
      left join menu_categories mc on mc.id = mi.category_id
      group by 1
    ) x
  ),
  unsold_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'menu_item_id', mi.id, 'name', mi.name, 'category', coalesce(mc.name, 'Uncategorised')
    ) order by mi.name), '[]'::jsonb) as arr
    from menu_items mi
    left join menu_categories mc on mc.id = mi.category_id
    where mi.cafe_id = p_cafe_id and mi.archived = false and mi.available = true
      and not exists (select 1 from item_sales s where s.menu_item_id = mi.id)
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'total_gross_sales', (select amt from total_gross),
      'distinct_items_sold', (select count(*) from item_sales)
    ),
    'items', (select arr from items_json),
    'categories', (select arr from categories_json),
    'unsold_items', (select arr from unsold_json)
  ) into v_result;

  return v_result;
end $$;

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
      and o.payment_status in ('paid', 'refunded')
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

create or replace function business_overview_report(
  p_cafe_id uuid,
  p_from    timestamptz,
  p_to      timestamptz
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz             text;
  v_compare_from   timestamptz;
  v_compare_to     timestamptz;
  v_crm_ok         boolean;
  v_inventory_ok   boolean;
  v_result         jsonb;
begin
  if not is_cafe_member(p_cafe_id) then
    raise exception 'not authorized';
  end if;
  if p_to <= p_from then
    raise exception 'invalid range';
  end if;

  select coalesce(timezone, 'Asia/Kolkata') into v_tz from cafes where id = p_cafe_id;
  v_crm_ok := cafe_has_feature(p_cafe_id, 'crm');
  v_inventory_ok := cafe_has_feature(p_cafe_id, 'inventory');

  v_compare_from := p_from - (p_to - p_from);
  v_compare_to   := p_from;

  with base as (
    select o.*, v_tz as cafe_tz
    from orders o
    where o.cafe_id = p_cafe_id and o.status <> 'cancelled'
      and o.created_at >= p_from and o.created_at < p_to
  ),
  gross as (
    select coalesce(sum(oi.price * oi.qty), 0) as amt
    from order_items oi join base b on b.id = oi.order_id
  ),
  discounts as (
    select coalesce(sum(discount), 0) as amt from base
  ),
  refunds_now as (
    select coalesce(sum(amount), 0) as amt, count(*) as cnt
    from refunds
    where cafe_id = p_cafe_id and status = 'completed'
      and created_at >= p_from and created_at < p_to
  ),
  tax_now as (
    select coalesce(sum(tax), 0) as amt from base
  ),
  collected_now as (
    select coalesce(sum(amount), 0) as amt
    from payments where cafe_id = p_cafe_id and order_id is not null
      and created_at >= p_from and created_at < p_to
  ),
  outstanding_now as (
    select coalesce(sum(greatest(0, o.total - coalesce((select sum(amount) from payments p where p.order_id = o.id), 0))), 0) as amt
    from base o
  ),
  cancelled_now as (
    select count(*) as cnt from orders
    where cafe_id = p_cafe_id and status = 'cancelled'
      and created_at >= p_from and created_at < p_to
  ),
  customers_now as (
    select count(distinct customer_id) as cnt from base where customer_id is not null
  ),

  cmp_base as (
    select o.* from orders o
    where o.cafe_id = p_cafe_id and o.status <> 'cancelled'
      and o.created_at >= v_compare_from and o.created_at < v_compare_to
  ),
  cmp_gross as (
    select coalesce(sum(oi.price * oi.qty), 0) as amt
    from order_items oi join cmp_base b on b.id = oi.order_id
  ),
  cmp_discounts as (select coalesce(sum(discount), 0) as amt from cmp_base),
  cmp_refunds as (
    select coalesce(sum(amount), 0) as amt
    from refunds where cafe_id = p_cafe_id and status = 'completed'
      and created_at >= v_compare_from and created_at < v_compare_to
  ),

  by_type as (
    select coalesce(jsonb_agg(jsonb_build_object('type', t, 'gross_sales', amt, 'orders', cnt) order by amt desc), '[]'::jsonb) as arr
    from (
      select b.type::text as t, sum(oi.price * oi.qty) as amt, count(distinct b.id) as cnt
      from order_items oi join base b on b.id = oi.order_id
      group by b.type
    ) x
  ),
  by_source as (
    select coalesce(jsonb_agg(jsonb_build_object('source', s, 'gross_sales', amt, 'orders', cnt) order by amt desc), '[]'::jsonb) as arr
    from (
      select b.source as s, sum(oi.price * oi.qty) as amt, count(distinct b.id) as cnt
      from order_items oi join base b on b.id = oi.order_id
      group by b.source
    ) x
  ),
  by_payment_method as (
    select coalesce(jsonb_agg(jsonb_build_object('method', method, 'amount', amt) order by amt desc), '[]'::jsonb) as arr
    from (
      select method::text as method, sum(amount) as amt
      from payments
      where cafe_id = p_cafe_id and order_id is not null
        and created_at >= p_from and created_at < p_to
      group by 1
    ) x
  ),
  by_day as (
    -- Tax-exclusive, per-order discount-netted — matches the headline Net
    -- Sales basis. NOT refund-netted per day (see migration header); key
    -- renamed net_sales -> sales so the chart no longer overclaims parity
    -- with the fully refund-netted headline figure.
    select coalesce(jsonb_agg(jsonb_build_object('date', d, 'sales', amt, 'orders', cnt) order by d), '[]'::jsonb) as arr
    from (
      select to_char(created_at at time zone cafe_tz, 'YYYY-MM-DD') as d,
             sum(total - tax) as amt, count(*) as cnt
      from base
      group by 1
    ) x
  ),
  by_hour as (
    select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'sales', amt, 'orders', cnt) order by h), '[]'::jsonb) as arr
    from (
      select extract(hour from created_at at time zone cafe_tz)::int as h,
             sum(total - tax) as amt, count(*) as cnt
      from base
      group by 1
    ) x
  ),
  top_items as (
    select coalesce(jsonb_agg(jsonb_build_object('name', name, 'qty', qty, 'gross_sales', amt) order by amt desc), '[]'::jsonb) as arr
    from (
      select oi.name, sum(oi.qty) as qty, sum(oi.price * oi.qty) as amt
      from order_items oi join base b on b.id = oi.order_id
      group by oi.name
      order by amt desc
      limit 5
    ) x
  ),
  top_categories as (
    select coalesce(jsonb_agg(jsonb_build_object('category', cat, 'gross_sales', amt) order by amt desc), '[]'::jsonb) as arr
    from (
      select coalesce(mc.name, 'Uncategorised') as cat, sum(oi.price * oi.qty) as amt
      from order_items oi
      join base b on b.id = oi.order_id
      left join menu_items mi on mi.id = oi.menu_item_id
      left join menu_categories mc on mc.id = mi.category_id
      group by 1
      order by amt desc
      limit 5
    ) x
  ),
  top_customers as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', name, 'phone_masked', phone_masked, 'orders', cnt, 'spend', amt
    ) order by amt desc), '[]'::jsonb) as arr
    from (
      select coalesce(cu.name, 'Guest') as name,
             '******' || right(cu.phone, 4) as phone_masked,
             count(*) as cnt, sum(b.total) as amt
      from base b
      join customers cu on cu.id = b.customer_id
      group by cu.id, cu.name, cu.phone
      order by amt desc
      limit 5
    ) x
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'gross_sales', (select amt from gross),
      'discounts',   (select amt from discounts),
      'refunds',     (select amt from refunds_now),
      'net_sales',   (select amt from gross) - (select amt from discounts) - (select amt from refunds_now),
      'tax',         (select amt from tax_now),
      'collected',   (select amt from collected_now),
      'outstanding', (select amt from outstanding_now),
      'orders',      (select count(*) from base),
      'aov',         case when (select count(*) from base) > 0
                       then round((
                         (select amt from gross) - (select amt from discounts) - (select amt from refunds_now)
                       )::numeric / (select count(*) from base))
                       else 0 end,
      'customers',   (select cnt from customers_now),
      'cancelled_orders', (select cnt from cancelled_now)
    ),
    'compare', jsonb_build_object(
      'from', v_compare_from, 'to', v_compare_to,
      'net_sales', (select amt from cmp_gross) - (select amt from cmp_discounts) - (select amt from cmp_refunds),
      'orders',    (select count(*) from cmp_base),
      'refunds',   (select amt from cmp_refunds)
    ),
    'by_type',           (select arr from by_type),
    'by_source',         (select arr from by_source),
    'by_payment_method', (select arr from by_payment_method),
    'by_day',            (select arr from by_day),
    'by_hour',           (select arr from by_hour),
    'top_items',         (select arr from top_items),
    'top_categories',    (select arr from top_categories),
    'top_customers',     case when v_crm_ok then (select arr from top_customers) else '[]'::jsonb end,
    'attention', jsonb_build_object(
      'outstanding_amount', (select amt from outstanding_now),
      'refunds_amount',     (select amt from refunds_now),
      'cancelled_orders',   (select cnt from cancelled_now),
      'low_stock_count',    case when v_inventory_ok then (select count(*) from low_stock_items(p_cafe_id)) else 0 end
    )
  ) into v_result;

  return v_result;
end $$;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_proc where proname = 'payments_outstanding_report') <> 1 then
    raise exception 'payments_outstanding_report: expected exactly one overload';
  end if;
  if (select count(*) from pg_proc where proname = 'sales_report') <> 1 then
    raise exception 'sales_report: expected exactly one overload';
  end if;
  if (select count(*) from pg_proc where proname = 'items_categories_report') <> 1 then
    raise exception 'items_categories_report: expected exactly one overload';
  end if;
  if (select count(*) from pg_proc where proname = 'advanced_analytics_report') <> 1 then
    raise exception 'advanced_analytics_report: expected exactly one overload';
  end if;
  if (select count(*) from pg_proc where proname = 'business_overview_report') <> 1 then
    raise exception 'business_overview_report: expected exactly one overload';
  end if;
end $$;
