-- ============================================================================
-- 0057 — Report 1: Business Overview (Reports V2, phase 1 of many).
--
-- Uses the ONE canonical waterfall documented in KHAOPIYO_REPORT_DEFINITIONS.md:
--   Gross Sales − Discounts − Refunds = Net Sales
-- computed over non-cancelled orders PLACED in [p_from, p_to), with Refunds
-- recognized in the period the refund itself occurred (not retroactively
-- reopening the original order's period). Collected/Outstanding are the
-- existing cash-basis definitions from outstanding_summary (0042/0047),
-- reused verbatim rather than redefined here.
--
-- Does not touch sales_report, profitability_report, outstanding_summary or
-- list_bills — those stay exactly as they are for the specific questions
-- they already answer correctly. This is a new, additive report.
-- ============================================================================

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
  v_result         jsonb;
begin
  if not is_cafe_member(p_cafe_id) then
    raise exception 'not authorized';
  end if;
  if p_to <= p_from then
    raise exception 'invalid range';
  end if;

  select coalesce(timezone, 'Asia/Kolkata') into v_tz from cafes where id = p_cafe_id;

  -- Comparison period: same duration, immediately preceding (definitions doc).
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
    from payments where cafe_id = p_cafe_id and created_at >= p_from and created_at < p_to
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

  -- ── Comparison period: only the four headline KPIs, not the full breakdown ──
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

  -- ── Breakdowns (current period only) ────────────────────────────────────
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
    -- Cash-basis, matching "Collected" — a payment recorded in range, joined
    -- back to its order only to label the method (payments.method is the
    -- tender actually used, independent of the order's placement period).
    select coalesce(jsonb_agg(jsonb_build_object('method', method, 'amount', amt) order by amt desc), '[]'::jsonb) as arr
    from (
      -- payment_method is a strict enum ('cash','card','upi','split','counter')
      -- with no null/fallback label — cast, don't coalesce onto an invalid one.
      select method::text as method, sum(amount) as amt
      from payments
      where cafe_id = p_cafe_id and created_at >= p_from and created_at < p_to
      group by 1
    ) x
  ),
  by_day as (
    select coalesce(jsonb_agg(jsonb_build_object('date', d, 'net_sales', amt, 'orders', cnt) order by d), '[]'::jsonb) as arr
    from (
      select to_char(created_at at time zone cafe_tz, 'YYYY-MM-DD') as d,
             sum(total) as amt, count(*) as cnt
      from base
      group by 1
    ) x
  ),
  by_hour as (
    -- Peak hours — bucketed in the café's own timezone, not UTC.
    select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'sales', amt, 'orders', cnt) order by h), '[]'::jsonb) as arr
    from (
      select extract(hour from created_at at time zone cafe_tz)::int as h,
             sum(total) as amt, count(*) as cnt
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
    'top_customers',     (select arr from top_customers),
    'attention', jsonb_build_object(
      'outstanding_amount', (select amt from outstanding_now),
      'refunds_amount',     (select amt from refunds_now),
      'cancelled_orders',   (select cnt from cancelled_now),
      'low_stock_count',    (select count(*) from low_stock_items(p_cafe_id))
    )
  ) into v_result;

  return v_result;
end $$;

revoke execute on function business_overview_report(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function business_overview_report(uuid, timestamptz, timestamptz) to authenticated;
