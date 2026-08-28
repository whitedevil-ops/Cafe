-- ============================================================================
-- Full-audit finding: sales_report (feeds both the Sales report page AND the
-- Day Close page's Revenue/Net profit KPIs) double-counts a fully refunded
-- order's loss. Its `base` CTE required payment_status = 'paid' -- but
-- refund_order() flips a FULLY refunded order's payment_status to 'refunded'
-- (0145_gst_credit_notes.sql:256-260; a partial refund correctly leaves it
-- 'paid', so this bug only ever hits a full refund). That order's revenue
-- then vanished from `base` entirely -- while refund_total still separately
-- subtracted the exact same refund from `refunds`, independent of the
-- order's current status. Net effect: subtracting the same money twice, once
-- by omission and once explicitly.
--
-- Live-verified: a real ₹79 order, paid then fully refunded (true net cash
-- impact ₹0), reported net_profit=-₹79, orders=0 -- while
-- business_overview_report (which never filters on payment_status, only on
-- status <> 'cancelled', and sums refunds separately and correctly) reported
-- the accurate net_sales=₹0, orders=1 for the identical order/range. This
-- also meant a past, already-elapsed sales_report figure could silently
-- change later, any time a refund was subsequently processed against an
-- order that fell inside that period.
--
-- Fix: include an order in `base` when payment_status is 'paid' OR
-- 'refunded' (i.e. "this order was paid at some point"), not only 'paid'.
-- refund_total's separate subtraction is untouched and still correct -- the
-- order's own revenue/discount/tax no longer vanishes alongside it. Genuinely
-- unpaid orders remain correctly excluded, unchanged.
-- ============================================================================

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
    -- expenses.spent_on is a plain date (the calendar day it was logged
    -- against); p_from/p_to are UTC instants, converted through the
    -- café's own timezone before comparing, not a casual ::date cast.
    select coalesce(sum(amount), 0) as total
    from expenses
    where cafe_id = p_cafe_id
      and spent_on >= (p_from at time zone v_tz)::date
      and spent_on < (p_to at time zone v_tz)::date
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

revoke execute on function sales_report(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function sales_report(uuid, timestamptz, timestamptz) to authenticated;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_proc where proname = 'sales_report') <> 1 then
    raise exception 'sales_report: expected exactly one overload';
  end if;
end $$;
