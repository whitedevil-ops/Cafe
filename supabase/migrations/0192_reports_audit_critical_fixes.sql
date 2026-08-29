-- ============================================================================
-- 0192 — Fixes for the 4 CRITICAL findings from the full Reports-module audit
-- (14-agent live verification, every figure hand-calculated against a real
-- throwaway fixture before being trusted). All three functions are pure
-- re-bodies — none of these fixes change a signature.
--
-- 1. business_overview_report's "Collected" KPI and payment-method mix both
--    summed ALL payments in range with no `order_id is not null` guard — the
--    exact bug class migration 0186 already fixed in outstanding_summary,
--    never applied here. Live-confirmed on the real pilot café: 7 real
--    orphan payment rows (₹1,056, a 2026-07-23 abandoned split-bill attempt)
--    still inflate this exact KPI today.
--
-- 2. business_overview_report's top_customers (CRM) and attention.
--    low_stock_count (inventory) were redacted only in TypeScript
--    (redactReport() in overview-client.tsx) — the RPC itself never checked
--    cafe_has_feature. Live-confirmed: a trial-plan café (crm:false,
--    inventory:false) got the full unredacted customer list and a real
--    low-stock count via a direct RPC call, bypassing the app entirely.
--    Same fix migration 0184 already applied to gst_invoice_report/
--    adjustments_report, applied here for the first time.
--
-- 3. sales_report's expense_total CTE cast p_to straight to ::date, which
--    excludes today's expenses on every preset except "Yesterday" (the only
--    one that happens to end exactly at local midnight) — live-reproduced:
--    "Today"/"Last 7 days"/"Last 30 days"/"This month" all returned
--    expenses=0 for a real same-day expense. Net profit was silently
--    overstated by the full day's real expenses on the report's own default
--    view. Fixed by comparing against the LAST included day
--    (p_to minus one instant), not p_to's own day.
--
-- 4. recommendation_report had no plan/entitlement check at all, unlike its
--    Profitability nav-sibling (which the UI groups it with as the same
--    paid tier) — live-confirmed a starter-plan café (advanced_reports:
--    false) could pull the full report via direct RPC call. Same
--    cafe_has_feature('advanced_reports') check profitability_report and
--    operations_report already have (migration 0166), added here.
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
    -- order_id is not null: excludes orphan (order-less) payment rows, same
    -- as collected_now above — an orphan row has no order to attribute a
    -- tender-type breakdown to anyway.
    select coalesce(jsonb_agg(jsonb_build_object('method', method, 'amount', amt) order by amt desc), '[]'::jsonb) as arr
    from (
      -- payment_method is a strict enum ('cash','card','upi','split','counter')
      -- with no null/fallback label — cast, don't coalesce onto an invalid one.
      select method::text as method, sum(amount) as amt
      from payments
      where cafe_id = p_cafe_id and order_id is not null
        and created_at >= p_from and created_at < p_to
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
-- Grants unchanged (authenticated only).

create or replace function sales_report(p_cafe_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
  v_tz     text;
begin
  if not is_cafe_member(p_cafe_id) then
    raise exception 'not authorized';
  end if;

  select coalesce(timezone, 'Asia/Kolkata') into v_tz from cafes where id = p_cafe_id;

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
    -- expenses.spent_on is a plain date; p_from/p_to are UTC instants,
    -- exclusive of p_to (the standard [from, to) range everywhere else in
    -- this codebase). Casting p_to straight to ::date and comparing with
    -- `<` was wrong whenever p_to isn't exactly local midnight — e.g. p_to
    -- = "now" on 29 Aug casts to '2026-08-29', and `spent_on < '2026-08-29'`
    -- excludes every expense logged TODAY, on every preset except
    -- "Yesterday" (the one preset whose p_to happens to be local midnight).
    -- Comparing against the LAST included instant's date instead (p_to
    -- minus one microsecond) fixes this for every preset without changing
    -- Yesterday's already-correct result.
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
      'expenses',   (select total from expense_total),
      'net_profit', coalesce((select sum(total) from base), 0)
                    - (select total from refund_total)
                    - (select total from expense_total)
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
-- Grants unchanged (authenticated only).

create or replace function recommendation_report(p_cafe_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not has_cafe_role(p_cafe_id, array['owner','manager']::member_role[]) then
    raise exception 'not authorized';
  end if;
  if not cafe_has_feature(p_cafe_id, 'advanced_reports') then
    raise exception 'advanced reports are not available on this café''s plan';
  end if;

  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(row_to_json(x) order by x.added desc)
      from (
        select mi.name,
               count(*) filter (where e.kind = 'impression') as shown,
               count(*) filter (where e.kind = 'add') as added,
               case when count(*) filter (where e.kind = 'impression') > 0
                    then round(count(*) filter (where e.kind = 'add') * 100.0 / count(*) filter (where e.kind = 'impression'), 1)
                    else 0 end as conversion,
               count(*) filter (where e.kind = 'add') * mi.price as added_sales
          from recommendation_events e
          join menu_items mi on mi.id = e.suggested_item_id
         where e.cafe_id = p_cafe_id and e.created_at >= p_from and e.created_at < p_to
         group by mi.id, mi.name, mi.price
      ) x), '[]'::jsonb),
    'top_pairings', coalesce((
      select jsonb_agg(jsonb_build_object('a', a.name, 'b', b.name, 'times', s.times) order by s.times desc)
      from (
        select item_id, paired_item_id, times from order_pair_stats
        where cafe_id = p_cafe_id and item_id < paired_item_id
        order by times desc limit 8
      ) s join menu_items a on a.id = s.item_id join menu_items b on b.id = s.paired_item_id), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;
-- Grants unchanged (authenticated only).

-- ── self-check ───────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_proc where proname = 'business_overview_report') <> 1 then
    raise exception 'business_overview_report: expected exactly one overload';
  end if;
  if (select count(*) from pg_proc where proname = 'sales_report') <> 1 then
    raise exception 'sales_report: expected exactly one overload';
  end if;
  if (select count(*) from pg_proc where proname = 'recommendation_report') <> 1 then
    raise exception 'recommendation_report: expected exactly one overload';
  end if;
end $$;
