-- ============================================================================
-- 0195 — Reports-module audit, MEDIUM-severity fixes, part 1 of 2. All four
-- functions below are pure re-bodies — no signature changes.
--
-- 1. adjustments_report's approved_by_name had no fallback to email/'Staff'
--    (unlike the sibling `actor` field in the same query) — a real approver
--    with no profile full_name set would render as a blank approver.
--
-- 2. advanced_analytics_report's forecast_next_7d cutoff compared against
--    p_to::date (the database session timezone), unlike every other date
--    computation in the same function, so the trailing window could cover
--    6-8 days instead of exactly 7 depending on time of day. Also had no
--    refund awareness at all — a refunded order's full gross total stayed in
--    daily_revenue/hourly_heatmap with no offsetting figure anywhere, unlike
--    Sales Report which surfaces refunds as a distinct line. Both fixed
--    together since both touch the same daily/hourly CTEs.
--
-- 3. items_categories_report never read the refunds table at all — a fully
--    refunded item's qty/gross_sales was identical to a non-refunded one.
--    Live-demonstrated by the audit: refunding a ₹150 item returned
--    byte-for-byte identical results before and after. Now nets refunded qty
--    per line, the same correlated-subquery pattern profitability_report
--    already uses — only works for ITEM-level refunds (kind='item'), same
--    documented limitation profitability_report already has for a
--    non-itemized full/partial refund, where which specific items were
--    "refunded" is inherently unknown.
--
-- 4. payments_outstanding_report never surfaced refunds at all — a
--    cancelled-and-refunded order's original payment still counted fully
--    toward "Collected" with no refunded figure anywhere on this report,
--    unlike the dashboard home which surfaces `refunded` separately. Added
--    as a new, purely additive `refunded` summary field — does not change
--    the existing `collected`/`by_method` figures, which stay a cash-basis
--    "what physically came in" number by design.
-- ============================================================================

create or replace function adjustments_report(
  p_cafe_id uuid, p_from timestamptz, p_to timestamptz
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not is_cafe_member(p_cafe_id) then raise exception 'not authorized'; end if;
  if p_to <= p_from then raise exception 'invalid range'; end if;
  if p_to - p_from > interval '1 day' and not cafe_has_feature(p_cafe_id, 'advanced_reports') then
    raise exception 'advanced reports are not available on this café''s plan';
  end if;

  with discounts as (
    select al.created_at, al.entity_id as order_id, o.short_code,
           coalesce(p.full_name, p.email, 'Staff') as actor,
           (al.meta->>'amount')::integer as amount,
           al.meta->>'type' as discount_type,
           al.meta->>'coupon_code' as coupon_code
    from audit_logs al
    left join profiles p on p.id = al.actor_id
    left join orders o on o.id = al.entity_id
    where al.cafe_id = p_cafe_id and al.action = 'order.discount_applied'
      and al.created_at >= p_from and al.created_at < p_to
  ),
  cancellations as (
    select al.created_at, al.entity_id as order_id,
           coalesce(al.meta->>'short_code', '') as short_code,
           coalesce(p.full_name, p.email, 'Staff') as actor,
           (al.meta->>'total')::integer as amount,
           al.meta->>'reason' as reason
    from audit_logs al
    left join profiles p on p.id = al.actor_id
    where al.cafe_id = p_cafe_id and al.action = 'order.cancelled'
      and al.created_at >= p_from and al.created_at < p_to
  ),
  refund_rows as (
    select r.created_at, r.order_id, o.short_code,
           coalesce(p.full_name, p.email, 'Staff') as actor,
           r.amount, r.kind, r.reason,
           coalesce(ap.full_name, ap.email, 'Staff') as approved_by_name
    from refunds r
    left join profiles p on p.id = r.refunded_by
    left join profiles ap on ap.id = r.approved_by
    left join orders o on o.id = r.order_id
    where r.cafe_id = p_cafe_id and r.status = 'completed'
      and r.created_at >= p_from and r.created_at < p_to
  ),
  discounts_capped as (select * from discounts order by created_at desc limit 500),
  discounts_json as (
    select
      coalesce((select jsonb_agg(jsonb_build_object(
        'order_id', order_id, 'short_code', short_code, 'actor', actor,
        'type', discount_type, 'coupon_code', coupon_code, 'amount', amount, 'created_at', created_at
      ) order by created_at desc) from discounts_capped), '[]'::jsonb) as arr,
      (select coalesce(sum(amount), 0) from discounts) as total,
      (select count(*) from discounts) as cnt
  ),
  cancellations_capped as (select * from cancellations order by created_at desc limit 500),
  cancellations_json as (
    select
      coalesce((select jsonb_agg(jsonb_build_object(
        'order_id', order_id, 'short_code', short_code, 'actor', actor,
        'reason', reason, 'amount', amount, 'created_at', created_at
      ) order by created_at desc) from cancellations_capped), '[]'::jsonb) as arr,
      (select coalesce(sum(amount), 0) from cancellations) as total,
      (select count(*) from cancellations) as cnt
  ),
  refunds_capped as (select * from refund_rows order by created_at desc limit 500),
  refunds_json as (
    select
      coalesce((select jsonb_agg(jsonb_build_object(
        'order_id', order_id, 'short_code', short_code, 'actor', actor,
        'kind', kind, 'reason', reason, 'amount', amount, 'approved_by', approved_by_name, 'created_at', created_at
      ) order by created_at desc) from refunds_capped), '[]'::jsonb) as arr,
      (select coalesce(sum(amount), 0) from refund_rows) as total,
      (select count(*) from refund_rows) as cnt
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'discounts_total', (select total from discounts_json), 'discounts_count', (select cnt from discounts_json),
      'refunds_total', (select total from refunds_json), 'refunds_count', (select cnt from refunds_json),
      'cancellations_total', (select total from cancellations_json), 'cancellations_count', (select cnt from cancellations_json)
    ),
    'discounts', (select arr from discounts_json),
    'refunds', (select arr from refunds_json),
    'cancellations', (select arr from cancellations_json),
    'discounts_truncated', (select cnt from discounts_json) > 500,
    'refunds_truncated', (select cnt from refunds_json) > 500,
    'cancellations_truncated', (select cnt from cancellations_json) > 500
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
  refunds_daily as (
    select (r.created_at at time zone v_tz)::date as d, sum(r.amount) as amt
    from refunds r
    where r.cafe_id = p_cafe_id and r.status = 'completed'
      and r.created_at >= p_from and r.created_at < p_to
    group by 1
  ),
  refunds_hourly as (
    select extract(dow from r.created_at at time zone v_tz)::int as dow,
           extract(hour from r.created_at at time zone v_tz)::int as hr,
           sum(r.amount) as amt
    from refunds r
    where r.cafe_id = p_cafe_id and r.status = 'completed'
      and r.created_at >= p_from and r.created_at < p_to
    group by 1, 2
  ),
  daily as (
    -- Refund-netted: a refund is attributed to the day IT happened on, same
    -- convention sales_report uses, not the original order's day.
    select o.d, o.revenue - coalesce(rf.amt, 0) as revenue, o.orders
    from (
      select (created_at at time zone v_tz)::date as d, sum(total) as revenue, count(*) as orders
      from orders_in_range group by 1
    ) o
    left join refunds_daily rf on rf.d = o.d
  ),
  daily_json as (
    select coalesce(jsonb_agg(jsonb_build_object('date', d, 'revenue', revenue, 'orders', orders) order by d), '[]'::jsonb) as arr
    from daily
  ),
  hourly as (
    select h.dow, h.hr, h.revenue - coalesce(rh.amt, 0) as revenue, h.orders
    from (
      select extract(dow from created_at at time zone v_tz)::int as dow,
             extract(hour from created_at at time zone v_tz)::int as hr,
             sum(total) as revenue, count(*) as orders
      from orders_in_range group by 1, 2
    ) h
    left join refunds_hourly rh on rh.dow = h.dow and rh.hr = h.hr
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
    -- Was p_to::date (database session timezone) — could cover 6-8 days
    -- instead of exactly 7 depending on time of day. Now matches `daily`'s
    -- own café-local bucketing.
    select coalesce(avg(revenue), 0) as avg_daily from daily where d >= ((p_to at time zone v_tz)::date - 7)
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
  lines as (
    select oi.order_id, oi.menu_item_id, oi.name, oi.price,
      (oi.qty - coalesce((
        select sum(ri.qty) from refund_items ri
        join refunds r on r.id = ri.refund_id
        where ri.order_item_id = oi.id and r.status = 'completed'
      ), 0)) as net_qty
    from order_items oi join base b on b.id = oi.order_id
  ),
  item_sales as (
    select menu_item_id, name,
           sum(net_qty) as qty, sum(net_qty * price) as gross_sales,
           count(distinct order_id) as orders
    from lines
    where net_qty > 0
    group by menu_item_id, name
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
      select coalesce(mc.name, 'Uncategorised') as cat, sum(l.net_qty) as qty, sum(l.net_qty * l.price) as amt
      from lines l
      left join menu_items mi on mi.id = l.menu_item_id
      left join menu_categories mc on mc.id = mi.category_id
      where l.net_qty > 0
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
  refunded_now as (
    select coalesce(sum(amount), 0) as amt
    from refunds
    where cafe_id = p_cafe_id and status = 'completed'
      and created_at >= p_from and created_at < p_to
  ),
  by_method_json as (
    select coalesce(jsonb_agg(jsonb_build_object('method', method, 'amount', amt, 'transactions', cnt) order by amt desc), '[]'::jsonb) as arr
    from (
      select method::text as method, sum(amount) as amt, count(*) as cnt
      from payments
      where cafe_id = p_cafe_id and order_id is not null
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
      'refunded', (select amt from refunded_now),
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

-- ── self-check ───────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_proc where proname = 'adjustments_report') <> 1 then
    raise exception 'adjustments_report: expected exactly one overload';
  end if;
  if (select count(*) from pg_proc where proname = 'advanced_analytics_report') <> 1 then
    raise exception 'advanced_analytics_report: expected exactly one overload';
  end if;
  if (select count(*) from pg_proc where proname = 'items_categories_report') <> 1 then
    raise exception 'items_categories_report: expected exactly one overload';
  end if;
  if (select count(*) from pg_proc where proname = 'payments_outstanding_report') <> 1 then
    raise exception 'payments_outstanding_report: expected exactly one overload';
  end if;
end $$;
