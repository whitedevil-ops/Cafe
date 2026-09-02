-- ============================================================================
-- 0209 — The printed bill carries the details a real till receipt carries.
--
-- Asked for directly: put the customer's name and phone number, and the rest
-- of the bill's details, on the print. Three fields were missing from
-- get_receipt entirely, so the page had nothing to render even if it wanted to.
--
--   staff_name  — who rang the bill up. orders.staff_id has always been there
--                 and list_bills already resolves it through profiles
--                 (0097:42, `p.full_name as staff_name`); the receipt never
--                 did, so the one document the customer takes away is the one
--                 that cannot say who served them.
--   phone       — the FULL number, and only for staff. See below.
--   notes       — order notes ("no onion", "pack separately"). They affect what
--                 was actually served, so they belong on the bill the kitchen's
--                 work is being charged on.
--
-- WHY THE PHONE IS GATED, AND NOT SIMPLY UNMASKED
--
-- /r/<token> is a PUBLIC page. That is the whole point of it — the café sends
-- the link over WhatsApp and SMS, and those links get forwarded. Replacing
-- '******2237' with a real mobile number would publish a customer's phone to
-- everyone that link ever reaches, which is a privacy regression dressed up as
-- a feature request.
--
-- So the full number is returned only when the caller is an active member of
-- that café. get_receipt is SECURITY DEFINER but auth.uid() still resolves
-- from the caller's own JWT, so is_cafe_member() answers for whoever is
-- actually asking: the till printing a copy sees the number, the guest opening
-- their link — and anyone they forward it to — still sees the mask. Both
-- render from the same page; only the payload differs.
--
-- phone_masked is deliberately kept alongside it rather than replaced, so
-- every existing caller (the PDF export, the bill drawer) keeps working
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
      -- Staff only. A forwarded bill link must never carry a real number.
      'phone_full', case when is_cafe_member(o.cafe_id) then o.phone end,
      'customer_name', cu.name,
      'staff_name', p.full_name,
      'notes', nullif(trim(o.notes), '')),
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
  -- Aliased p, and the payments subquery re-aliased to p2, because the
  -- payments aggregate above already used p for its own table.
  left join profiles p on p.id = o.staff_id
  where o.receipt_token = p_token;
$$;

grant execute on function get_receipt(uuid) to anon, authenticated;

-- ── self-check ─────────────────────────────────────────────────────────────
do $$
declare v_src text;
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'get_receipt') <> 1 then
    raise exception 'get_receipt: expected exactly one overload';
  end if;

  select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_receipt';

  -- The three new fields.
  if position('staff_name' in v_src) = 0 then raise exception 'get_receipt lost staff_name'; end if;
  if position('phone_full' in v_src) = 0 then raise exception 'get_receipt lost phone_full'; end if;

  -- The gate itself. If a later edit ever returns o.phone unconditionally,
  -- every forwarded bill link starts publishing a customer's mobile number.
  if position('is_cafe_member(o.cafe_id) then o.phone' in v_src) = 0 then
    raise exception 'get_receipt returns the full phone without the member check';
  end if;

  -- And the mask must survive for the guest-facing path and every existing
  -- caller of it (PDF export, bill drawer).
  if position('phone_masked' in v_src) = 0 then
    raise exception 'get_receipt lost phone_masked';
  end if;

  -- 0162's bill-link gating must not have been dropped by this rewrite.
  if position('bill_link_enabled' in v_src) = 0 then
    raise exception 'get_receipt lost the bill_link_enabled gating from 0162';
  end if;
end $$;
