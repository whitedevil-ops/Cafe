-- ============================================================================
-- 0104 — Bulk bill/receipt export for café owners.
--
-- Owner wants to pick a date range and download every issued bill from that
-- period as one file (accounting/GST filing). No existing RPC returns full
-- receipt detail (line items, GST breakdown) for MORE THAN ONE order at a
-- time: get_receipt takes a single token, and list_bills deliberately
-- returns only summary columns for the on-screen table, capped at 500 rows
-- for pagination.
--
-- list_bill_receipts returns the SAME jsonb shape as get_receipt (cafe,
-- order, gst_invoice, items) — one element per matching order — so the
-- client renders bulk-export pages with the exact same layout code as the
-- single-receipt download. Capped at 1000 rows (vs list_bills' 500) since
-- this is a deliberate one-off export, not a paginated screen; callers over
-- the cap get is_truncated=true and should narrow the range.
-- ============================================================================

create or replace function list_bill_receipts(
  p_cafe_id uuid,
  p_from    timestamptz,
  p_to      timestamptz,
  p_type    text default 'all',      -- all | dine_in | takeaway
  p_payment text default 'all',      -- all | paid | partial | unpaid | refunded
  p_limit   integer default 1000
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_cafe   record;
  v_result jsonb;
  v_total  integer;
begin
  if not is_cafe_member(p_cafe_id) then
    raise exception 'not authorized';
  end if;

  select name, legal_name, trade_name, address, city, state, pincode, state_code,
         gstin, logo_url, phone, gst_registered, tax_inclusive,
         coalesce(timezone, 'Asia/Kolkata') as timezone
    into v_cafe
    from cafes where id = p_cafe_id;

  with base as (
    select o.*, t.label as table_label,
           coalesce((select sum(amount) from payments pay where pay.order_id = o.id), 0) as paid,
           coalesce((select sum(amount) from refunds r where r.order_id = o.id and r.status = 'completed'), 0) as refunded
      from orders o
      left join cafe_tables t on t.id = o.table_id
     where o.cafe_id = p_cafe_id
       and o.created_at >= p_from and o.created_at < p_to
       and (p_type = 'all' or o.type::text = p_type)
  ),
  filtered as (
    select * from base b
    where p_payment = 'all'
       or (p_payment = 'refunded' and b.refunded > 0)
       or (p_payment = 'paid'     and b.status <> 'cancelled' and b.paid >= b.total and b.total > 0)
       or (p_payment = 'partial'  and b.status <> 'cancelled' and b.paid > 0 and b.paid < b.total)
       or (p_payment = 'unpaid'   and b.status <> 'cancelled' and b.paid = 0)
  )
  select count(*) into v_total from filtered;

  select coalesce(jsonb_agg(jsonb_build_object(
      'cafe', jsonb_build_object(
        'name', v_cafe.name, 'legal_name', v_cafe.legal_name, 'trade_name', v_cafe.trade_name,
        'address', v_cafe.address, 'city', v_cafe.city, 'state', v_cafe.state, 'pincode', v_cafe.pincode,
        'gstin', v_cafe.gstin, 'logo_url', v_cafe.logo_url, 'phone', v_cafe.phone,
        'gst_registered', v_cafe.gst_registered, 'tax_inclusive', v_cafe.tax_inclusive, 'timezone', v_cafe.timezone),
      'order', jsonb_build_object(
        'short_code', f.short_code, 'created_at', f.created_at, 'order_type', f.type::text,
        'payment_status', f.payment_status, 'payment_method', f.payment_method,
        'subtotal', f.subtotal, 'discount', f.discount, 'tax', f.tax,
        'service_charge', f.service_charge, 'total', f.total,
        'coupon_code', f.coupon_code, 'table_label', f.table_label,
        'phone_masked', case when f.phone is not null then '******' || right(f.phone, 4) end),
      'gst_invoice', case when f.gst_invoice_number is not null then jsonb_build_object(
        'invoice_number',  f.gst_invoice_number,
        'issued_at',       f.gst_invoice_issued_at,
        'taxable_amount',  (select coalesce(sum(i.taxable_value), 0) from order_items i where i.order_id = f.id),
        'cgst',            f.tax / 2,
        'sgst',            f.tax - (f.tax / 2),
        'place_of_supply', coalesce(v_cafe.state, '') ||
                           case when v_cafe.state_code is not null then ' (' || v_cafe.state_code || ')' else '' end
      ) else null end,
      'items', (select coalesce(jsonb_agg(jsonb_build_object(
          'name', i.name, 'qty', i.qty, 'price', i.price, 'modifiers', i.modifiers,
          'hsn_sac', i.hsn_sac, 'tax_percent', i.tax_percent,
          'taxable_value', i.taxable_value, 'tax_amount', i.tax_amount) order by i.name), '[]'::jsonb)
        from order_items i where i.order_id = f.id)
    )), '[]'::jsonb)
    into v_result
    from (select * from filtered order by created_at asc limit greatest(1, least(coalesce(p_limit, 1000), 1000))) f;

  return jsonb_build_object('receipts', v_result, 'total', v_total, 'is_truncated', v_total > jsonb_array_length(v_result));
end $$;

revoke execute on function list_bill_receipts(uuid, timestamptz, timestamptz, text, text, integer) from public, anon;
grant execute on function list_bill_receipts(uuid, timestamptz, timestamptz, text, text, integer) to authenticated;
