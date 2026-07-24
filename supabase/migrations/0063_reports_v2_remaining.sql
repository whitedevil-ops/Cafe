-- ============================================================================
-- 0063 — Reports V2, remaining five: Items & Categories, Payments & Aging,
-- GST (invoice-basis), Adjustments, Operations.
--
-- Same shape as business_overview_report (0057): one CTE-based query per
-- function, is_cafe_member() authorization, stable security definer.
--
-- Deliberately does NOT duplicate existing reports:
--   * profitability_report (0052) already owns cost/margin per item — this
--     migration's items report is volume/mix only (qty, gross sales, share).
--   * business_overview_report's by_hour already owns peak-hour load —
--     operations_report covers turnaround/turnover/staff instead.
-- GST report is invoice-basis (gst_invoice_issued_at, gst_invoice_number is
-- not null) per KHAOPIYO_REPORT_DEFINITIONS.md — never recomputed from
-- today's tax settings.
-- ============================================================================

-- ── 1. Items & Categories ───────────────────────────────────────────────────
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
  -- Live menu items that sold zero (or near-zero) in range — a different
  -- question from profitability_report, which only ever sees items that DID
  -- sell at least once.
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

revoke execute on function items_categories_report(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function items_categories_report(uuid, timestamptz, timestamptz) to authenticated;

-- ── 2. Payments & Outstanding (aging) ───────────────────────────────────────
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
    from payments where cafe_id = p_cafe_id and created_at >= p_from and created_at < p_to
  ),
  by_method_json as (
    select coalesce(jsonb_agg(jsonb_build_object('method', method, 'amount', amt, 'transactions', cnt) order by amt desc), '[]'::jsonb) as arr
    from (
      select method::text as method, sum(amount) as amt, count(*) as cnt
      from payments where cafe_id = p_cafe_id and created_at >= p_from and created_at < p_to
      group by 1
    ) x
  ),
  -- Outstanding is a cash-basis, current-state question (same definition as
  -- business_overview_report's outstanding_now) — orders PLACED in range that
  -- still carry a balance as of right now, aged from their placement time.
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
    'outstanding_bills', (select arr from bills_json)
  ) into v_result;

  return v_result;
end $$;

revoke execute on function payments_outstanding_report(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function payments_outstanding_report(uuid, timestamptz, timestamptz) to authenticated;

-- ── 3. GST (invoice-basis) ──────────────────────────────────────────────────
create or replace function gst_invoice_report(
  p_cafe_id uuid, p_from timestamptz, p_to timestamptz
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_registered boolean;
  v_result     jsonb;
begin
  if not is_cafe_member(p_cafe_id) then raise exception 'not authorized'; end if;
  if p_to <= p_from then raise exception 'invalid range'; end if;

  select coalesce(gst_registered, false) into v_registered from cafes where id = p_cafe_id;

  with invoiced as (
    select o.* from orders o
    where o.cafe_id = p_cafe_id and o.gst_invoice_number is not null
      and o.gst_invoice_issued_at >= p_from and o.gst_invoice_issued_at < p_to
  ),
  lines as (
    select oi.* from order_items oi join invoiced o on o.id = oi.order_id
  ),
  totals as (
    select coalesce(sum(taxable_value), 0) as taxable, coalesce(sum(tax_amount), 0) as tax from lines
  ),
  by_rate_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'hsn_sac', hsn_sac, 'tax_percent', tax_percent,
      'taxable_value', taxable, 'cgst', tax / 2, 'sgst', tax - tax / 2, 'tax', tax
    ) order by hsn_sac), '[]'::jsonb) as arr
    from (
      select coalesce(hsn_sac, '') as hsn_sac, coalesce(tax_percent, 0) as tax_percent,
             sum(taxable_value) as taxable, sum(tax_amount) as tax
      from lines
      group by 1, 2
    ) x
  ),
  invoices_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'invoice_number', gst_invoice_number, 'issued_at', gst_invoice_issued_at,
      'short_code', short_code, 'taxable_value', subtotal - discount,
      'tax', tax, 'cgst', tax / 2, 'sgst', tax - tax / 2, 'total', total
    ) order by gst_invoice_issued_at), '[]'::jsonb) as arr
    from invoiced
  )
  select jsonb_build_object(
    'gst_registered', v_registered,
    'summary', jsonb_build_object(
      'invoices', (select count(*) from invoiced),
      'taxable_value', (select taxable from totals),
      'tax', (select tax from totals),
      'cgst', (select tax from totals) / 2,
      'sgst', (select tax from totals) - (select tax from totals) / 2
    ),
    'by_rate', (select arr from by_rate_json),
    'invoices', (select arr from invoices_json)
  ) into v_result;

  return v_result;
end $$;

revoke execute on function gst_invoice_report(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function gst_invoice_report(uuid, timestamptz, timestamptz) to authenticated;

-- ── 4. Adjustments (discounts, refunds, cancellations — with actor+reason) ─
create or replace function adjustments_report(
  p_cafe_id uuid, p_from timestamptz, p_to timestamptz
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not is_cafe_member(p_cafe_id) then raise exception 'not authorized'; end if;
  if p_to <= p_from then raise exception 'invalid range'; end if;

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
           ap.full_name as approved_by_name
    from refunds r
    left join profiles p on p.id = r.refunded_by
    left join profiles ap on ap.id = r.approved_by
    left join orders o on o.id = r.order_id
    where r.cafe_id = p_cafe_id and r.status = 'completed'
      and r.created_at >= p_from and r.created_at < p_to
  ),
  discounts_json as (
    select
      coalesce(jsonb_agg(jsonb_build_object(
        'order_id', order_id, 'short_code', short_code, 'actor', actor,
        'type', discount_type, 'coupon_code', coupon_code, 'amount', amount, 'created_at', created_at
      ) order by created_at desc), '[]'::jsonb) as arr,
      coalesce(sum(amount), 0) as total, count(*) as cnt
    from discounts
  ),
  cancellations_json as (
    select
      coalesce(jsonb_agg(jsonb_build_object(
        'order_id', order_id, 'short_code', short_code, 'actor', actor,
        'reason', reason, 'amount', amount, 'created_at', created_at
      ) order by created_at desc), '[]'::jsonb) as arr,
      coalesce(sum(amount), 0) as total, count(*) as cnt
    from cancellations
  ),
  refunds_json as (
    select
      coalesce(jsonb_agg(jsonb_build_object(
        'order_id', order_id, 'short_code', short_code, 'actor', actor,
        'kind', kind, 'reason', reason, 'amount', amount, 'approved_by', approved_by_name, 'created_at', created_at
      ) order by created_at desc), '[]'::jsonb) as arr,
      coalesce(sum(amount), 0) as total, count(*) as cnt
    from refund_rows
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'discounts_total', (select total from discounts_json), 'discounts_count', (select cnt from discounts_json),
      'refunds_total', (select total from refunds_json), 'refunds_count', (select cnt from refunds_json),
      'cancellations_total', (select total from cancellations_json), 'cancellations_count', (select cnt from cancellations_json)
    ),
    'discounts', (select arr from discounts_json),
    'refunds', (select arr from refunds_json),
    'cancellations', (select arr from cancellations_json)
  ) into v_result;

  return v_result;
end $$;

revoke execute on function adjustments_report(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function adjustments_report(uuid, timestamptz, timestamptz) to authenticated;

-- ── 5. Operations (turnaround, table turnover, per-staff) ───────────────────
-- Deliberately does not restate by_hour (already in business_overview_report).
-- created_at→done_at is the only stored prep/service timestamp pair — there
-- is no separate "ready_at", so this measures full order-to-completion time,
-- named accordingly rather than implying kitchen-only prep time.
create or replace function operations_report(
  p_cafe_id uuid, p_from timestamptz, p_to timestamptz
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not is_cafe_member(p_cafe_id) then raise exception 'not authorized'; end if;
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
  by_staff_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'staff', staff_name, 'orders', cnt, 'sales', amt,
      'avg_order_value', case when cnt > 0 then round(amt::numeric / cnt) else 0 end
    ) order by amt desc), '[]'::jsonb) as arr
    from (
      select coalesce(p.full_name, p.email, 'Unknown') as staff_name,
             count(*) as cnt, sum(o.total) as amt
      from orders o
      left join profiles p on p.id = o.staff_id
      where o.cafe_id = p_cafe_id and o.status <> 'cancelled' and o.staff_id is not null
        and o.created_at >= p_from and o.created_at < p_to
      group by 1
    ) x
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
    'by_staff', (select arr from by_staff_json),
    'cancelled_orders', (select cnt from cancelled)
  ) into v_result;

  return v_result;
end $$;

revoke execute on function operations_report(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function operations_report(uuid, timestamptz, timestamptz) to authenticated;
