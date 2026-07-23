-- ============================================================================
-- 0034 — Fold expenses into sales_report for a true net-profit figure.
--
-- SELF-CAUGHT CORRECTION: this migration originally tried to create an
-- `expenses` table and a role-restricted RLS policy. Both were wrong —
-- `expenses` already exists in schema.sql (category, amount, spent_on,
-- vendor, method, notes, receipt_url) with its own "member all" policy
-- (any active café member, via is_cafe_member — not owner/manager/
-- accountant only, which is what a first draft here assumed). A
-- `create table if not exists` would have silently no-op'd, my new policy
-- would have been redundant at best (permissive RLS policies OR together,
-- so a broader pre-existing policy already made a narrower new one
-- pointless) and my SQL would have flat-out failed by referencing a
-- column (`expense_date`) that doesn't exist. Caught by checking
-- schema.sql before shipping, not after. Nothing about the existing table
-- or its RLS is touched here — this migration does exactly one thing:
-- extend sales_report (0032) to also report expenses and net profit.
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
      and o.payment_status = 'paid'
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
