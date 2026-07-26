-- ============================================================================
-- 0095 — Bills showed orders.payment_method, which is really "how the order
-- was expected to be paid at creation time" (defaults to 'counter' for a
-- POS/dine-in order) — not "how it was actually settled". Only record_payment
-- (0044) ever updates it after the fact; the Razorpay webhook and
-- wallet_charge_order (0091) both insert real `payments` rows without
-- touching orders.payment_method, so a dine-in order created as 'counter'
-- but paid via wallet (or Razorpay) still showed "At counter" in Bills.
--
-- Fix: derive the displayed method from the actual payments ledger for that
-- order instead — one distinct method shows that method, more than one shows
-- 'split' (the UI already renders that label), and only an order with zero
-- payments yet falls back to the original orders.payment_method (there is
-- nothing else to show for a bill that hasn't been paid).
-- ============================================================================

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
           coalesce((select sum(amount) from refunds r where r.order_id = o.id and r.status = 'completed'), 0) as refunded,
           (select case count(distinct pay.method)
              when 0 then null
              when 1 then min(pay.method::text)
              else 'split'
            end
            from payments pay where pay.order_id = o.id) as actual_method
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
              coalesce(b.actual_method, b.payment_method::text) as payment_method,
              b.staff_name, b.receipt_token,
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
