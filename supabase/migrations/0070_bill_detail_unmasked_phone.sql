-- ============================================================================
-- 0070 — bill_detail masked the customer's phone even though this is a
-- staff-only, authenticated view (is_cafe_member already gates it) — the
-- same masking pattern that makes sense on a customer-facing receipt has no
-- reason to hide the number from the café's own staff, who need to actually
-- call the customer. Renamed phone_masked -> phone since it no longer is.
-- Identical signature, pure body change.
-- ============================================================================

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
      'customer_name', cu.name, 'phone', o.phone,
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
