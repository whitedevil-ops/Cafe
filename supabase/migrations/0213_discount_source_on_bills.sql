-- ============================================================================
-- 0213 — A bill's "Discount" line says WHAT the discount was, not just how much.
--
-- Reported live from Bill No. 11: "Discount −₹8" with nothing on the receipt
-- to say the ₹8 was the guest's spin prize (10% off next visit), redeemed
-- W3CNMK. staff_place_order folds every discount source into one
-- `orders.discount` number (0154) — a manual staff discount, a coupon, and a
-- spin prize all land in the same field. The receipt already named the coupon
-- ("Discount (SAVE10)"); it never named the spin prize, because get_receipt
-- never looked for one.
--
-- The source of truth for "was a spin prize redeemed against this order" is
-- spin_results.redeemed_order_id — set exactly once, by redeem_spin_prize,
-- inside the same transaction that computed the discount (0154:528,547). At
-- most one row can point at a given order, because staff_place_order accepts
-- a single p_spin_code.
--
-- Two functions get the same small addition, so the customer receipt, its PDF
-- export, and the staff bill drawer all agree:
--   get_receipt  (0209) — the customer's own bill, /r/<token>
--   bill_detail  (0070) — the staff-facing bill lookup in the dashboard
--
-- Both are read-only SQL/PLPGSQL additions. Every other field, join and gate
-- already on each function (0209's phone_full member check included) is
-- untouched.
-- ============================================================================

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
      'timezone', coalesce(c.timezone, 'Asia/Kolkata'),
      'bill_link_url', case when c.bill_link_enabled then c.bill_link_url else null end,
      'bill_link_label', case when c.bill_link_enabled then c.bill_link_label else null end),
    'order', jsonb_build_object(
      'short_code', o.short_code, 'created_at', o.created_at, 'status', o.status,
      'order_type', o.type,
      'payment_status', o.payment_status, 'payment_method', o.payment_method,
      'subtotal', o.subtotal, 'discount', o.discount, 'tax', o.tax,
      'service_charge', o.service_charge, 'total', o.total,
      'coupon_code', o.coupon_code, 'table_label', t.label,
      'phone_masked', case when o.phone is not null then '******' || right(o.phone, 4) end,
      'phone_full', case when is_cafe_member(o.cafe_id) then o.phone end,
      'customer_name', cu.name,
      'staff_name', p.full_name,
      'notes', nullif(trim(o.notes), ''),
      -- Which spin prize, if any, contributed to o.discount. Not the amount
      -- alone (already visible as part of o.discount) — the label, so
      -- "Discount" can read "Discount (10% off next visit)".
      'spin_prize', (
        select jsonb_build_object('label', sr.label, 'code', sr.code, 'kind', sr.kind, 'value', sr.value)
        from spin_results sr where sr.redeemed_order_id = o.id limit 1
      )),
    'gst_invoice', case when o.gst_invoice_number is not null then jsonb_build_object(
      'invoice_number',  o.gst_invoice_number,
      'issued_at',       o.gst_invoice_issued_at,
      'taxable_amount',  (select coalesce(sum(i.taxable_value), 0) from order_items i where i.order_id = o.id),
      'cgst',            o.tax / 2,
      'sgst',            o.tax - (o.tax / 2),
      'place_of_supply', coalesce(c.state, '') ||
                         case when c.state_code is not null then ' (' || c.state_code || ')' else '' end
    ) else null end,
    'credit_notes', (select coalesce(jsonb_agg(jsonb_build_object(
        'credit_note_number', r.credit_note_number,
        'issued_at', r.credit_note_issued_at,
        'amount', r.amount,
        'taxable_value', r.credit_note_taxable_value,
        'tax_amount', r.credit_note_tax_amount,
        'cgst', r.credit_note_tax_amount / 2,
        'sgst', r.credit_note_tax_amount - (r.credit_note_tax_amount / 2),
        'reason', r.reason
      ) order by r.credit_note_issued_at), '[]'::jsonb)
      from refunds r
      where r.order_id = o.id and r.credit_note_number is not null and r.status = 'completed'),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object(
        'method', p2.method, 'amount', p2.amount, 'reference', p2.reference,
        'status', p2.status, 'provider', p2.provider, 'created_at', p2.created_at
      ) order by p2.created_at), '[]'::jsonb)
      from payments p2 where p2.order_id = o.id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'name', i.name, 'qty', i.qty, 'price', i.price, 'modifiers', i.modifiers,
        'hsn_sac', i.hsn_sac, 'tax_percent', i.tax_percent,
        'taxable_value', i.taxable_value, 'tax_amount', i.tax_amount,
        'is_reward', i.reward_id is not null,
        'combo_group', i.combo_group,
        'combo_name', cb.name,
        'combo_price', cb.price)
        order by i.combo_group nulls first, i.name), '[]'::jsonb)
      from order_items i
      left join combos cb on cb.id = i.combo_id
      where i.order_id = o.id)
  )
  from orders o
  join cafes c on c.id = o.cafe_id
  left join cafe_tables t on t.id = o.table_id
  left join customers cu on cu.id = o.customer_id
  left join profiles p on p.id = o.staff_id
  where o.receipt_token = p_token;
$$;

grant execute on function get_receipt(uuid) to anon, authenticated;

-- ── bill_detail: the staff-facing equivalent (0070) gets the same field, plus
-- the coupon_code it never exposed at all — the drawer's "Discount" line has
-- been unconditionally bare since it was written. ─────────────────────────
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
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_receipt';
  if v_src is null or position('spin_prize' in v_src) = 0 then
    raise exception 'get_receipt is missing spin_prize';
  end if;
  -- The member gate from 0209 must have survived this rewrite too.
  if position('is_cafe_member(o.cafe_id) then o.phone' in v_src) = 0 then
    raise exception 'get_receipt lost the phone_full member gate from 0209';
  end if;

  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'bill_detail';
  if v_src is null or position('spin_prize' in v_src) = 0 then
    raise exception 'bill_detail is missing spin_prize';
  end if;
  if position('coupon_code' in v_src) = 0 then
    raise exception 'bill_detail is missing coupon_code';
  end if;
  -- 0070's own reason for existing: staff see the real phone, not a mask.
  if position('''phone'', o.phone' in v_src) = 0 then
    raise exception 'bill_detail lost the unmasked phone from 0070';
  end if;

  if (select count(*) from pg_proc where proname = 'get_receipt') <> 1 then
    raise exception 'get_receipt: expected exactly one overload';
  end if;
  if (select count(*) from pg_proc where proname = 'bill_detail') <> 1 then
    raise exception 'bill_detail: expected exactly one overload';
  end if;
end $$;
