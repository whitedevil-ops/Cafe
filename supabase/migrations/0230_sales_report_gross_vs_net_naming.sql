-- ============================================================================
-- 0230 — sales_report's top_items/by_category used the same unqualified
-- "revenue" key as its own summary and by_payment_method/by_source/by_staff
-- breakdowns, but on a DIFFERENT basis: oi.price*qty (the line's undiscounted
-- menu price) versus orders.total (post-discount, what apply_order_taxes
-- actually charged). Any order with a discount in the period — a coupon,
-- staff-applied, loyalty, or a combo bundle's automatic savings — made the
-- item/category breakdown sum to more than the page's own headline Revenue,
-- with nothing in the field name or UI copy to explain why.
--
-- Pure rename, not a recalculation: this does not change a single number
-- sales_report has ever returned, only what the pre-discount figure is
-- called — matching items_categories_report/business_overview_report's own
-- convention, which already name this exact figure gross_sales everywhere
-- it appears (0195_reports_audit_medium_part1.sql). Recomputing top_items/
-- by_category onto the net (taxable_value) basis instead was the audit's
-- other suggested option, but that WOULD change the numbers a café sees for
-- every item/category whenever a discount applies in the period, which is a
-- business-logic change this fix deliberately avoids making unprompted.
-- ============================================================================

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
    -- 0230: 'gross_sales', not 'revenue' — see this migration's header.
    select coalesce(jsonb_agg(jsonb_build_object('name', name, 'qty', qty, 'gross_sales', rev) order by rev desc), '[]'::jsonb) as arr
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
    -- 0230: 'gross_sales', not 'revenue' — see this migration's header.
    select coalesce(jsonb_agg(jsonb_build_object('category', cat, 'gross_sales', rev) order by rev desc), '[]'::jsonb) as arr
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

-- ── self-check ───────────────────────────────────────────────────────────
do $$
declare v_src text; v_hits int;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'sales_report';
  if v_src is null then raise exception 'sales_report does not exist'; end if;

  select count(*) into v_hits from regexp_matches(v_src, '''gross_sales'',\s*rev', 'g');
  if v_hits <> 2 then
    raise exception 'expected exactly 2 gross_sales occurrences (top_items, by_category), found %', v_hits;
  end if;
end $$;
