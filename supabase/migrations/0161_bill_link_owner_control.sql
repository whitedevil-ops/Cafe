-- ============================================================================
-- Replace the star-rating feedback gate on the customer bill with a plain,
-- owner-controlled link — any URL, no KhaoPiyo rating prompt in between.
--
-- Reuses the same "a URL stored on cafes, shown on the bill" shape
-- google_review_url already was, but as its own clearly-named field rather
-- than repurposing a Google-specific column: the old one was tied to the
-- 4/5-star gate (components/receipt/feedback-form.tsx, now deleted) — a
-- fundamentally different flow — and its stored data is left untouched
-- rather than dropped, since a café may still hold a real value there.
--
-- bill_link_enabled is a separate switch from the URL itself, on purpose —
-- an owner can turn the CTA off without losing/retyping the link.
--
-- The scheme check is the real security boundary here, not just the
-- frontend form: `^https?://` structurally excludes javascript:/data:/
-- vbscript: and anything else that isn't a plain web URL, enforced on every
-- write regardless of what called it (owner's own UPDATE via the client
-- SDK, this migration, or anything else).
-- ============================================================================

alter table cafes add column if not exists bill_link_url text;
alter table cafes add column if not exists bill_link_enabled boolean not null default true;

alter table cafes drop constraint if exists cafes_bill_link_url_scheme_chk;
alter table cafes add constraint cafes_bill_link_url_scheme_chk
  check (bill_link_url is null or bill_link_url ~* '^https?://\S+$');

-- ── get_receipt: swap google_review_url for the new owner-controlled link.
--    Everything else byte-for-byte identical to the live body (0160). ───────
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
      'bill_link_url', case when c.bill_link_enabled then c.bill_link_url else null end),
    'order', jsonb_build_object(
      'short_code', o.short_code, 'created_at', o.created_at, 'status', o.status,
      'order_type', o.type,
      'payment_status', o.payment_status, 'payment_method', o.payment_method,
      'subtotal', o.subtotal, 'discount', o.discount, 'tax', o.tax,
      'service_charge', o.service_charge, 'total', o.total,
      'coupon_code', o.coupon_code, 'table_label', t.label,
      'phone_masked', case when o.phone is not null then '******' || right(o.phone, 4) end,
      'customer_name', cu.name),
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
        'method', p.method, 'amount', p.amount, 'reference', p.reference,
        'status', p.status, 'provider', p.provider, 'created_at', p.created_at
      ) order by p.created_at), '[]'::jsonb)
      from payments p where p.order_id = o.id),
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
  where o.receipt_token = p_token;
$$;

grant execute on function get_receipt(uuid) to anon, authenticated;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'cafes' and column_name = 'bill_link_url') then
    raise exception 'cafes.bill_link_url column missing';
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'cafes' and column_name = 'bill_link_enabled') then
    raise exception 'cafes.bill_link_enabled column missing';
  end if;
  if (select count(*) from pg_proc where proname = 'get_receipt') <> 1 then
    raise exception 'get_receipt: expected exactly one overload';
  end if;
end $$;
