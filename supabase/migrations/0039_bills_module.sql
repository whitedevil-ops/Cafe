-- ============================================================================
-- 0039 — Full GST invoice payload + the central Bills module.
--
-- A "bill" is NOT a new table. In this architecture an order IS the billable
-- unit: it already carries cafe_id, table/session, customer, staff, source,
-- payment_method, its own totals, an immutable receipt_token, and (for
-- registered cafés) a GST invoice number. Introducing a `bills` table would
-- create a second source of financial truth that could disagree with orders
-- — exactly what the one-canonical-model rule exists to prevent. These are
-- read functions over the existing orders/payments/refunds tables.
--
-- STATUS IS DERIVED FROM MONEY, never from a frontend flag: computed from
-- summed payments and summed completed refunds at read time.
-- ============================================================================

-- ── get_receipt: everything a GST tax invoice legally needs ────────────────
create or replace function get_receipt(p_token uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'cafe', jsonb_build_object(
      'name', c.name,
      'legal_name', c.legal_name,
      'trade_name', c.trade_name,
      'address', c.address, 'city', c.city, 'state', c.state, 'pincode', c.pincode,
      'gstin', c.gstin, 'logo_url', c.logo_url, 'phone', c.phone,
      'gst_registered', c.gst_registered,
      'tax_inclusive', c.tax_inclusive,
      'timezone', coalesce(c.timezone, 'Asia/Kolkata')),
    'order', jsonb_build_object(
      'short_code', o.short_code, 'created_at', o.created_at, 'status', o.status,
      'order_type', o.type,
      'payment_status', o.payment_status, 'payment_method', o.payment_method,
      'subtotal', o.subtotal, 'discount', o.discount, 'tax', o.tax,
      'service_charge', o.service_charge, 'total', o.total,
      'coupon_code', o.coupon_code, 'table_label', t.label,
      'phone_masked', case when o.phone is not null then '******' || right(o.phone, 4) end),
    'gst_invoice', case when o.gst_invoice_number is not null then jsonb_build_object(
      'invoice_number',  o.gst_invoice_number,
      'issued_at',       o.gst_invoice_issued_at,
      'taxable_amount',  (select coalesce(sum(i.taxable_value), 0) from order_items i where i.order_id = o.id),
      'cgst',            o.tax / 2,
      'sgst',            o.tax - (o.tax / 2),
      'place_of_supply', coalesce(c.state, '') ||
                         case when c.state_code is not null then ' (' || c.state_code || ')' else '' end
    ) else null end,
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'name', i.name, 'qty', i.qty, 'price', i.price, 'modifiers', i.modifiers,
        'hsn_sac', i.hsn_sac, 'tax_percent', i.tax_percent,
        'taxable_value', i.taxable_value, 'tax_amount', i.tax_amount) order by i.name), '[]'::jsonb)
      from order_items i where i.order_id = o.id)
  )
  from orders o
  join cafes c on c.id = o.cafe_id
  left join cafe_tables t on t.id = o.table_id
  where o.receipt_token = p_token;
$$;

grant execute on function get_receipt(uuid) to anon, authenticated;

-- ── Derived, money-authoritative bill status ───────────────────────────────
create or replace function bill_status(p_order_id uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_o        record;
  v_paid     integer;
  v_refunded integer;
begin
  select o.status, o.payment_status, o.total into v_o from orders o where o.id = p_order_id;
  if not found then return null; end if;
  if v_o.status = 'cancelled' then return 'CANCELLED'; end if;

  select coalesce(sum(amount), 0) into v_paid     from payments where order_id = p_order_id;
  select coalesce(sum(amount), 0) into v_refunded from refunds  where order_id = p_order_id and status = 'completed';

  if v_refunded > 0 and v_refunded >= v_paid and v_paid > 0 then return 'REFUNDED'; end if;
  if v_refunded > 0 then return 'PARTIALLY_REFUNDED'; end if;
  if v_o.payment_status = 'paid' or (v_paid > 0 and v_paid >= v_o.total) then return 'PAID'; end if;
  if v_paid > 0 then return 'PAYMENT_PENDING'; end if;
  return 'OPEN';
end $$;

revoke execute on function bill_status(uuid) from public, anon;
grant execute on function bill_status(uuid) to authenticated;

-- ── list_bills ─────────────────────────────────────────────────────────────
-- Tenant isolation is enforced INSIDE the function via is_cafe_member, so a
-- caller cannot list another café's bills by passing its id, and cannot
-- reach a bill by guessing an order id (no id parameter is accepted here).
create or replace function list_bills(
  p_cafe_id uuid,
  p_from    timestamptz,
  p_to      timestamptz,
  p_type    text default 'all',      -- all | dine_in | takeaway
  p_search  text default null,
  p_limit   integer default 100,
  p_offset  integer default 0
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_rows    jsonb;
  v_summary jsonb;
  v_q       text;
begin
  if not is_cafe_member(p_cafe_id) then
    raise exception 'not authorized';
  end if;
  v_q := nullif(trim(coalesce(p_search, '')), '');

  with base as (
    select o.*, t.label as table_label, cu.name as customer_name,
           p.full_name as staff_name,
           coalesce((select sum(amount) from payments pay where pay.order_id = o.id), 0) as paid,
           coalesce((select sum(amount) from refunds r where r.order_id = o.id and r.status = 'completed'), 0) as refunded
      from orders o
      left join cafe_tables t on t.id = o.table_id
      left join customers cu on cu.id = o.customer_id
      left join profiles p on p.id = o.staff_id
     where o.cafe_id = p_cafe_id
       and o.created_at >= p_from and o.created_at < p_to
       and (p_type = 'all' or o.type::text = p_type)
       and (v_q is null
            or o.short_code ilike '%' || v_q || '%'
            or coalesce(o.gst_invoice_number, '') ilike '%' || v_q || '%'
            or coalesce(t.label, '') ilike '%' || v_q || '%'
            or coalesce(o.phone, '') ilike '%' || v_q || '%'
            or coalesce(cu.name, '') ilike '%' || v_q || '%')
  )
  select
    jsonb_build_object(
      'count',    (select count(*) from base),
      'billed',   (select coalesce(sum(total), 0) from base where status <> 'cancelled'),
      'paid',     (select coalesce(sum(paid), 0) from base),
      'pending',  (select coalesce(sum(total - paid), 0) from base where status <> 'cancelled' and total > paid),
      'refunded', (select coalesce(sum(refunded), 0) from base)
    ),
    (select coalesce(jsonb_agg(row_to_json(x) order by x.created_at desc), '[]'::jsonb) from (
       select b.id, b.gst_invoice_number, b.short_code, b.created_at, b.type::text as order_type,
              b.table_label, b.customer_name, b.phone, b.total, b.paid, b.refunded,
              b.payment_method::text as payment_method, b.staff_name, b.receipt_token,
              case
                when b.status = 'cancelled' then 'CANCELLED'
                when b.refunded > 0 and b.refunded >= b.paid and b.paid > 0 then 'REFUNDED'
                when b.refunded > 0 then 'PARTIALLY_REFUNDED'
                when b.payment_status = 'paid' or (b.paid > 0 and b.paid >= b.total) then 'PAID'
                when b.paid > 0 then 'PAYMENT_PENDING'
                else 'OPEN'
              end as bill_status
         from base b
        order by b.created_at desc
        limit greatest(1, least(coalesce(p_limit, 100), 500))
       offset greatest(0, coalesce(p_offset, 0))
     ) x)
  into v_summary, v_rows;

  return jsonb_build_object('summary', v_summary, 'bills', v_rows);
end $$;

revoke execute on function list_bills(uuid, timestamptz, timestamptz, text, text, integer, integer) from public, anon;
grant execute on function list_bills(uuid, timestamptz, timestamptz, text, text, integer, integer) to authenticated;

-- ── bill_detail ────────────────────────────────────────────────────────────
-- Takes an order id, but resolves the café from the ROW and then checks
-- membership against that — so passing another café's order id fails the
-- authorization check rather than leaking it.
create or replace function bill_detail(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_cafe_id uuid;
  v_result  jsonb;
begin
  select cafe_id into v_cafe_id from orders where id = p_order_id;
  if v_cafe_id is null then raise exception 'bill not found'; end if;
  if not is_cafe_member(v_cafe_id) then raise exception 'not authorized'; end if;

  select jsonb_build_object(
    'order', jsonb_build_object(
      'id', o.id, 'invoice_number', o.gst_invoice_number, 'short_code', o.short_code,
      'created_at', o.created_at, 'done_at', o.done_at,
      'order_type', o.type::text, 'status', o.status::text,
      'payment_status', o.payment_status::text, 'payment_method', o.payment_method::text,
      'table_label', t.label, 'session_id', o.session_id,
      'customer_name', cu.name, 'phone_masked',
        case when o.phone is not null then '******' || right(o.phone, 4) end,
      'staff_name', pr.full_name,
      'subtotal', o.subtotal, 'discount', o.discount, 'tax', o.tax,
      'service_charge', o.service_charge, 'total', o.total,
      'cancel_reason', o.cancel_reason, 'receipt_token', o.receipt_token,
      'bill_status', bill_status(o.id)),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'name', i.name, 'qty', i.qty, 'price', i.price, 'modifiers', i.modifiers,
        'instructions', i.instructions, 'hsn_sac', i.hsn_sac,
        'tax_percent', i.tax_percent, 'taxable_value', i.taxable_value,
        'tax_amount', i.tax_amount)), '[]'::jsonb)
      from order_items i where i.order_id = o.id),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object(
        'method', pay.method::text, 'amount', pay.amount, 'created_at', pay.created_at)), '[]'::jsonb)
      from payments pay where pay.order_id = o.id),
    'refunds', (select coalesce(jsonb_agg(jsonb_build_object(
        'amount', r.amount, 'method', r.method::text, 'kind', r.kind,
        'reason', r.reason, 'status', r.status, 'created_at', r.created_at)), '[]'::jsonb)
      from refunds r where r.order_id = o.id),
    'session_orders', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', so.id, 'short_code', so.short_code, 'total', so.total,
        'created_at', so.created_at) order by so.created_at), '[]'::jsonb)
      from orders so
      where o.session_id is not null and so.session_id = o.session_id and so.cafe_id = v_cafe_id)
  ) into v_result
  from orders o
  left join cafe_tables t on t.id = o.table_id
  left join customers cu on cu.id = o.customer_id
  left join profiles pr on pr.id = o.staff_id
  where o.id = p_order_id;

  return v_result;
end $$;

revoke execute on function bill_detail(uuid) from public, anon;
grant execute on function bill_detail(uuid) to authenticated;
