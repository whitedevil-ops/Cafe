-- ============================================================================
-- Full-audit finding, high, live-confirmed on the real pilot café: the raw
-- gst_invoice_report/adjustments_report RPCs have no advanced_reports
-- entitlement check at all — only their _premium wrapper siblings
-- (gst_invoice_report_premium/adjustments_report_premium, migration 0166)
-- do, and those wrappers are the only thing the Reports > GST/Adjustments
-- pages actually call. Live-verified as the real owner of Brewora Café
-- (starter plan, advanced_reports:false): calling gst_invoice_report and
-- adjustments_report DIRECTLY, bypassing the premium wrapper entirely,
-- returned full real invoice/refund data with zero error — any authenticated
-- café staff member, any plan, can pull the whole advanced-reports dataset
-- for free via a direct RPC call.
--
-- This was deliberate, not an oversight — 0166's own comment explains why:
-- Day Close (available on every plan) also calls these same two raw RPCs,
-- always with a narrow, single-business-day range, and gating them outright
-- would have broken that base-plan feature. Closing the bypass without
-- breaking Day Close: reject only when BOTH the café lacks the entitlement
-- AND the requested range exceeds one day. Day Close never asks for more
-- than one business day (confirmed by reading day-close-client.tsx:69-74:
-- from = that day's start, to = the next day's start, or "now" for today) —
-- so every real Day Close call keeps working unchanged on every plan. Any
-- direct call asking for a genuinely wide range (a real premium-report use)
-- is now rejected on a plan without the entitlement, same as the premium
-- wrapper already enforces.
-- ============================================================================

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
  if p_to - p_from > interval '1 day' and not cafe_has_feature(p_cafe_id, 'advanced_reports') then
    raise exception 'advanced reports are not available on this café''s plan';
  end if;

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
  invoiced_capped as (
    select * from invoiced order by gst_invoice_issued_at desc limit 500
  ),
  invoices_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'invoice_number', gst_invoice_number, 'issued_at', gst_invoice_issued_at,
      'short_code', short_code, 'taxable_value', subtotal - discount,
      'tax', tax, 'cgst', tax / 2, 'sgst', tax - tax / 2, 'total', total
    ) order by gst_invoice_issued_at desc), '[]'::jsonb) as arr
    from invoiced_capped
  ),
  -- Credit notes issued in this range, regardless of when the ORIGINAL
  -- invoice was issued — a credit note against a January invoice issued in
  -- February belongs in February's return, same as real GST practice.
  credit_noted as (
    select r.* from refunds r
    where r.cafe_id = p_cafe_id and r.credit_note_number is not null and r.status = 'completed'
      and r.credit_note_issued_at >= p_from and r.credit_note_issued_at < p_to
  ),
  cn_totals as (
    select coalesce(sum(credit_note_taxable_value), 0) as taxable, coalesce(sum(credit_note_tax_amount), 0) as tax
    from credit_noted
  ),
  cn_capped as (
    select * from credit_noted order by credit_note_issued_at desc limit 500
  ),
  cn_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'credit_note_number', credit_note_number, 'issued_at', credit_note_issued_at,
      'order_id', order_id, 'amount', amount,
      'taxable_value', credit_note_taxable_value, 'tax', credit_note_tax_amount,
      'cgst', credit_note_tax_amount / 2, 'sgst', credit_note_tax_amount - credit_note_tax_amount / 2,
      'reason', reason
    ) order by credit_note_issued_at desc), '[]'::jsonb) as arr
    from cn_capped
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
    'credit_note_summary', jsonb_build_object(
      'count', (select count(*) from credit_noted),
      'taxable_value', (select taxable from cn_totals),
      'tax', (select tax from cn_totals),
      'cgst', (select tax from cn_totals) / 2,
      'sgst', (select tax from cn_totals) - (select tax from cn_totals) / 2
    ),
    'net_summary', jsonb_build_object(
      'taxable_value', (select taxable from totals) - (select taxable from cn_totals),
      'tax', (select tax from totals) - (select tax from cn_totals),
      'cgst', ((select tax from totals) - (select tax from cn_totals)) / 2,
      'sgst', ((select tax from totals) - (select tax from cn_totals))
              - (((select tax from totals) - (select tax from cn_totals)) / 2)
    ),
    'by_rate', (select arr from by_rate_json),
    'invoices', (select arr from invoices_json),
    'invoices_truncated', (select count(*) from invoiced) > 500,
    'credit_notes', (select arr from cn_json),
    'credit_notes_truncated', (select count(*) from credit_noted) > 500
  ) into v_result;

  return v_result;
end $$;

revoke execute on function gst_invoice_report(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function gst_invoice_report(uuid, timestamptz, timestamptz) to authenticated;

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
           ap.full_name as approved_by_name
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

revoke execute on function adjustments_report(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function adjustments_report(uuid, timestamptz, timestamptz) to authenticated;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_proc where proname = 'gst_invoice_report') <> 1 then
    raise exception 'gst_invoice_report: expected exactly one overload';
  end if;
  if (select count(*) from pg_proc where proname = 'adjustments_report') <> 1 then
    raise exception 'adjustments_report: expected exactly one overload';
  end if;
end $$;
