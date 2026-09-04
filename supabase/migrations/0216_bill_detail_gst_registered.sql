-- ============================================================================
-- 0216 — The staff bill drawer showed "HSN/SAC 996331 · GST 5% · taxable ₹100"
-- on every line of a bill at a café that is explicitly NOT GST-registered.
--
-- Reported live with a screenshot: cafes.gst_registered = false, confirmed
-- set that way deliberately in Café settings, order total correctly equals
-- subtotal with no CGST/SGST charged (order.tax = 0, so the summary section
-- is fine — it's already gated on `o.tax > 0`) — but the per-item line still
-- printed HSN/SAC, a GST percentage, and a "taxable value" as if this were a
-- real tax invoice line, because it never checked whether the café is
-- GST-registered at all.
--
-- ROOT CAUSE: bill_detail (0070, last touched 0213) has never returned
-- `gst_registered` — the frontend (app/dashboard/bills/bill-detail-drawer.tsx)
-- had no signal to gate on, so it rendered order_items.hsn_sac/tax_percent/
-- taxable_value unconditionally. The customer-facing receipt already gets
-- this right: get_receipt only returns a `gst_invoice` object at all when
-- `o.gst_invoice_number is not null` (0209/0213), and
-- app/r/[token]/page.tsx's own HSN/GST line is wrapped in `{r.gst_invoice &&
-- ...}` — this staff-facing screen just never got the same treatment.
--
-- The per-item hsn_sac/tax_percent/taxable_value/tax_amount data ITSELF is
-- untouched here and stays exactly as-is — it is legitimate stored snapshot
-- data on order_items (from whatever the menu item's own tax_percent was at
-- order time) and there is nothing wrong with keeping it. The bug was only
-- ever about DISPLAYING it to a café that has since said, in its own
-- settings, "we are not GST-registered."
--
-- Adds exactly one field: 'gst_registered', c.gst_registered — everything
-- else in this function is byte-identical to 0213's body.
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
      'coupon_code', o.coupon_code,
      -- NEW: the one field the drawer was missing to know whether it's
      -- allowed to call anything on this bill "GST".
      'gst_registered', c.gst_registered,
      'spin_prize', (
        select jsonb_build_object('label', sr.label, 'code', sr.code, 'kind', sr.kind, 'value', sr.value)
        from spin_results sr where sr.redeemed_order_id = o.id limit 1
      ),
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
  join cafes c on c.id = o.cafe_id
  left join cafe_tables t on t.id = o.table_id
  left join customers cu on cu.id = o.customer_id
  left join profiles pr on pr.id = o.staff_id
  where o.id = p_order_id;

  return v_result;
end $$;

revoke execute on function bill_detail(uuid) from public, anon;
grant execute on function bill_detail(uuid) to authenticated;

-- ── self-check ─────────────────────────────────────────────────────────────
do $$
declare v_src text;
begin
  if (select count(*) from pg_proc where proname = 'bill_detail') <> 1 then
    raise exception 'bill_detail: expected exactly one overload';
  end if;

  select p.prosrc into v_src from pg_proc p where p.proname = 'bill_detail';
  if position('gst_registered' in v_src) = 0 then
    raise exception 'bill_detail is missing gst_registered';
  end if;
  -- 0070's own reason for existing (unmasked phone for staff) and 0213's
  -- additions (coupon_code, spin_prize) must have survived this rewrite too.
  if position('''phone'', o.phone' in v_src) = 0 then
    raise exception 'bill_detail lost the unmasked phone from 0070';
  end if;
  if position('coupon_code' in v_src) = 0 or position('spin_prize' in v_src) = 0 then
    raise exception 'bill_detail lost coupon_code/spin_prize from 0213';
  end if;
end $$;
