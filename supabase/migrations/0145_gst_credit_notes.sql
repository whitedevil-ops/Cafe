-- ============================================================================
-- 0145 — HIGH: GST credit notes for refunds against a GST-invoiced order.
--
-- 0031 explicitly flagged this as a follow-up, not a silent gap: "Credit
-- notes for refunded orders (a distinct GST document, CGST Act s.34) are NOT
-- built here." refund_order (0028..0098) has stayed purely a `refunds` row —
-- an internal record, with no GST-compliant document, no serial number, and
-- no visible link back to the original tax invoice for the customer or for
-- GST return filing.
--
-- SCOPE, DELIBERATE (same posture as 0031's own scope note):
--   * Only issued when the ORIGINAL order carries a gst_invoice_number — a
--     non-GST café's refunds are untouched, exactly as before.
--   * The taxable-value/tax split is PROPORTIONAL to the order's overall
--     tax ratio (mirrors the exact share calculation refund_order already
--     uses to price a partial/item refund against the order total), not a
--     per-line, per-HSN-rate breakdown. This is accurate for the common
--     single-rate café and a reasonable approximation for a multi-rate one,
--     but is NOT a substitute for a CA/GST practitioner's review before a
--     café relies on these numbers for an actual GSTR filing — flagged
--     here and in the final report, not silently presented as fully
--     compliant.
--   * Credit notes get their own "CN" series, separate from the invoice's
--     own (possibly café-customised) invoice_prefix — standard GST practice
--     keeps credit note numbers in a distinct series from tax invoices.
--   * The original order/invoice row is never modified — its total, tax,
--     and gst_invoice_number stay exactly as issued. The refund is
--     represented as a wholly separate record (this migration), linked back
--     via refunds.order_id, which is how "preserve the original invoice,
--     represent the reversal separately" is satisfied without ever
--     rewriting billing history.
-- ============================================================================

-- ── Per-café, per-financial-year sequential counter — same shape as
--     gst_invoice_counters (0031), deliberately a separate table so a
--     credit note number can never collide with or skip an invoice number. ─
create table if not exists credit_note_counters (
  cafe_id        uuid not null references cafes(id) on delete cascade,
  financial_year text not null,
  next_number    integer not null default 1,
  primary key (cafe_id, financial_year)
);

alter table credit_note_counters enable row level security;
drop policy if exists "credit_note_counters read" on credit_note_counters;
create policy "credit_note_counters read" on credit_note_counters
  for select using (is_cafe_member(cafe_id));
-- No insert/update/delete policy, on purpose — same pattern as
-- gst_invoice_counters: the only legitimate writer is the claim function
-- below, running as its owning role.

create or replace function claim_credit_note_number(p_cafe_id uuid, p_fy text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  insert into credit_note_counters (cafe_id, financial_year, next_number)
  values (p_cafe_id, p_fy, 2)
  on conflict (cafe_id, financial_year)
    do update set next_number = credit_note_counters.next_number + 1
  returning next_number - 1 into v_n;
  return v_n;
end $$;

revoke execute on function claim_credit_note_number(uuid, text) from public, anon, authenticated;

-- ── The document itself lives on the refund row — one refund event is one
--     credit note, matching how a real café issues them (one document per
--     refund transaction, not per refunded line). ───────────────────────────
alter table refunds add column if not exists credit_note_number text;
alter table refunds add column if not exists credit_note_issued_at timestamptz;
alter table refunds add column if not exists credit_note_taxable_value integer;
alter table refunds add column if not exists credit_note_tax_amount integer;

create index if not exists refunds_credit_note_number_idx on refunds (cafe_id, credit_note_number)
  where credit_note_number is not null;

-- ── refund_order: issue the credit note inline, in the same transaction as
--     the refund itself. Byte-for-byte identical to its current live body
--     (0098) except the block marked below and the two new insert columns —
--     refund_order is the SOLE writer to `refunds` (confirmed by grep), so
--     this is the one and only place a credit note ever needs to be issued.
create or replace function refund_order(
  p_order_id uuid,
  p_reason   text,
  p_method   text default null,
  p_amount   integer default null,
  p_items    jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order        record;
  v_role         member_role;
  v_limit        integer;
  v_already      integer;
  v_remaining    integer;
  v_amount       integer := 0;
  v_kind         text;
  v_method       payment_method;
  v_actual       text;
  v_refund_id    uuid;
  v_item         jsonb;
  v_oi           record;
  v_qty          integer;
  v_prior_qty    integer;
  v_line_value   integer;
  v_share        integer;
  v_priced       jsonb := '[]'::jsonb;
  v_cn_number    text;
  v_cn_issued_at timestamptz;
  v_cn_taxable   integer;
  v_cn_tax       integer;
  v_tz           text;
  v_fy           text;
  v_seq          integer;
begin
  select o.id, o.cafe_id, o.customer_id, o.total, o.subtotal, o.payment_status, o.payment_method, o.short_code,
         o.gst_invoice_number, o.tax
    into v_order
    from orders o where o.id = p_order_id;
  if v_order.id is null then raise exception 'order not found'; end if;

  select role into v_role from cafe_members
   where cafe_id = v_order.cafe_id and user_id = auth.uid() and status = 'active';
  if v_role is null then raise exception 'not authorized for this café'; end if;
  if v_role not in ('owner', 'manager', 'cashier') then
    raise exception 'your role cannot issue refunds';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'a refund reason is required';
  end if;

  -- Refunding money that was never collected would silently invent a liability.
  if v_order.payment_status <> 'paid' then
    raise exception 'this order is not marked paid — there is nothing to refund';
  end if;

  v_already := order_refunded_total(p_order_id);
  v_remaining := v_order.total - v_already;
  if v_remaining <= 0 then raise exception 'this order has already been fully refunded'; end if;

  select case count(distinct method) when 1 then min(method::text) else null end into v_actual
    from payments where order_id = p_order_id;
  v_method := coalesce(nullif(p_method, '')::payment_method, nullif(v_actual, '')::payment_method, v_order.payment_method, 'cash');

  -- ── Item-level ───────────────────────────────────────────────────────────
  -- Validate and price every line BEFORE writing anything, so the authorisation
  -- check below sees the real total and no partially-built refund ever exists.
  if p_items is not null and jsonb_array_length(p_items) > 0 then
    v_kind := 'item';

    for v_item in select * from jsonb_array_elements(p_items) loop
      select oi.id, oi.price, oi.qty, oi.name into v_oi
        from order_items oi
       where oi.id = (v_item->>'order_item_id')::uuid and oi.order_id = p_order_id;
      if v_oi.id is null then raise exception 'item does not belong to this order'; end if;

      v_qty := greatest(1, coalesce((v_item->>'qty')::int, 1));

      -- Can't refund the same unit twice.
      select coalesce(sum(ri.qty), 0) into v_prior_qty
        from refund_items ri
        join refunds r on r.id = ri.refund_id
       where ri.order_item_id = v_oi.id and r.status = 'completed';
      if v_prior_qty + v_qty > v_oi.qty then
        raise exception 'cannot refund % × % — only % of that line remain unrefunded',
          v_qty, v_oi.name, v_oi.qty - v_prior_qty;
      end if;

      -- Refund the line's PROPORTIONAL share of what was actually charged, so
      -- an order-level discount or tax is not over-refunded. Refunding the raw
      -- line price on a discounted bill would hand back more than was taken.
      v_line_value := v_oi.price * v_qty;
      v_share := case when v_order.subtotal > 0
                      then round(v_order.total::numeric * v_line_value / v_order.subtotal)::integer
                      else v_line_value end;

      v_priced := v_priced || jsonb_build_object(
        'order_item_id', v_oi.id, 'qty', v_qty, 'amount', v_share);
      v_amount := v_amount + v_share;
    end loop;

    -- Rounding each line can drift a rupee past the remaining balance.
    v_amount := least(v_amount, v_remaining);
    if v_amount <= 0 then raise exception 'refund amount resolved to zero'; end if;

  -- ── Full / partial cash-value ────────────────────────────────────────────
  else
    v_amount := coalesce(p_amount, v_remaining);
    if v_amount <= 0 then raise exception 'refund amount must be greater than zero'; end if;
    if v_amount > v_remaining then
      raise exception 'cannot refund ₹% — only ₹% of this order remains unrefunded', v_amount, v_remaining;
    end if;
    v_kind := case when v_amount = v_order.total and v_already = 0 then 'full' else 'partial' end;
  end if;

  -- Authorisation is checked against the RESOLVED amount, not the requested
  -- one, so an item selection cannot be used to slip past a cashier's limit.
  select refund_approval_limit into v_limit from cafes where id = v_order.cafe_id;
  if v_role = 'cashier' and v_amount > coalesce(v_limit, 500) then
    raise exception 'refunds above ₹% need a manager or owner', coalesce(v_limit, 500);
  end if;

  if v_method = 'wallet' then
    if v_order.customer_id is null then
      raise exception 'this order has no linked customer — cannot refund to a wallet';
    end if;
    if not cafe_has_feature(v_order.cafe_id, 'wallet') then
      raise exception 'the wallet feature is not enabled for this café';
    end if;
  end if;

  -- ── GST credit note (0145) ──────────────────────────────────────────────
  -- Only when the original order actually carries a tax invoice number —
  -- a non-GST café's refund stays exactly as before, no document, no numbering.
  if v_order.gst_invoice_number is not null then
    select timezone into v_tz from cafes where id = v_order.cafe_id;
    v_fy  := gst_financial_year(now(), coalesce(v_tz, 'Asia/Kolkata'));
    v_seq := claim_credit_note_number(v_order.cafe_id, v_fy);
    v_cn_number    := 'CN/' || v_fy || '/' || lpad(v_seq::text, 5, '0');
    v_cn_issued_at := now();
    -- Same proportional-share logic already used above to price a partial/
    -- item refund against the order total — tax_amount is v_order.tax's
    -- share of v_amount within v_order.total, taxable_value is the rest.
    v_cn_tax     := case when v_order.total > 0
                         then round(v_order.tax::numeric * v_amount / v_order.total)::integer
                         else 0 end;
    v_cn_taxable := v_amount - v_cn_tax;
  end if;

  insert into refunds (cafe_id, order_id, amount, method, kind, reason, refunded_by, approved_by,
                        credit_note_number, credit_note_issued_at, credit_note_taxable_value, credit_note_tax_amount)
  values (v_order.cafe_id, p_order_id, v_amount, v_method, v_kind, trim(p_reason), auth.uid(),
          case when v_role in ('owner','manager') then auth.uid() end,
          v_cn_number, v_cn_issued_at, v_cn_taxable, v_cn_tax)
  returning id into v_refund_id;

  -- Item lines, priced above, written now that the refund row exists.
  if v_kind = 'item' then
    insert into refund_items (refund_id, order_item_id, qty, amount)
    select v_refund_id, (x->>'order_item_id')::uuid, (x->>'qty')::int, (x->>'amount')::int
      from jsonb_array_elements(v_priced) x;
  end if;

  -- The refund row above is the record of HOW the money left the café's
  -- books (unchanged for cash/card/upi — those stay a manual, off-system
  -- handback); a wallet refund additionally moves the money back into the
  -- customer's own balance, which no other method needs.
  if v_method = 'wallet' then
    perform pg_advisory_xact_lock(hashtext('wallet:' || v_order.cafe_id::text || ':' || v_order.customer_id::text));
    insert into wallet_transactions (cafe_id, customer_id, kind, amount, order_id, reason, created_by)
    values (v_order.cafe_id, v_order.customer_id, 'refund', v_amount, p_order_id,
            'Refund for order #' || v_order.short_code, auth.uid());
  end if;

  -- Only a fully refunded order flips status. 'partial' in this enum means
  -- partially PAID, so using it here would misreport a partly-refunded bill.
  if v_already + v_amount >= v_order.total then
    update orders set payment_status = 'refunded' where id = p_order_id;
  end if;

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (v_order.cafe_id, auth.uid(), 'order.refunded', 'orders', p_order_id,
          jsonb_build_object(
            'refund_id', v_refund_id, 'amount', v_amount, 'kind', v_kind,
            'method', v_method, 'reason', trim(p_reason), 'role', v_role,
            'order_total', v_order.total, 'previously_refunded', v_already,
            'credit_note_number', v_cn_number));

  return jsonb_build_object(
    'refund_id', v_refund_id, 'amount', v_amount, 'kind', v_kind,
    'method', v_method, 'remaining', v_order.total - (v_already + v_amount),
    'credit_note_number', v_cn_number);
end $$;

revoke execute on function refund_order(uuid, text, text, integer, jsonb) from public, anon;
grant execute on function refund_order(uuid, text, text, integer, jsonb) to authenticated;

-- ── get_receipt: surface issued credit notes alongside the original
--     invoice — "represent the reversal separately... link to original" is
--     satisfied by nesting these under the SAME receipt as the invoice they
--     reverse, never rewriting the invoice block itself. ───────────────────
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
      'google_review_url', c.google_review_url),
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
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'name', i.name, 'qty', i.qty, 'price', i.price, 'modifiers', i.modifiers,
        'hsn_sac', i.hsn_sac, 'tax_percent', i.tax_percent,
        'taxable_value', i.taxable_value, 'tax_amount', i.tax_amount,
        'is_reward', i.reward_id is not null,
        'combo_group', i.combo_group,
        'combo_name', cb.name,
        'combo_price', cb.price)
        -- Components of one combo stay adjacent so the receipt can render
        -- them under a single heading.
        order by i.combo_group nulls first, i.name), '[]'::jsonb)
      from order_items i
      left join combos cb on cb.id = i.combo_id
      where i.order_id = o.id)
  )
  from orders o
  join cafes c on c.id = o.cafe_id
  left join cafe_tables t on t.id = o.table_id
  where o.receipt_token = p_token;
$$;

grant execute on function get_receipt(uuid) to anon, authenticated;

-- ── gst_invoice_report: add credit-note and net figures, keyed by the same
--     date-range convention as invoices (credit_note_issued_at, mirroring
--     gst_invoice_issued_at). Byte-for-byte identical otherwise to the
--     current live body (0072). ────────────────────────────────────────────
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

-- ============================================================================
-- COMPLIANCE NOTE — read before relying on this for a real GSTR filing.
--
-- This migration produces a numbered, sequential credit note per refund
-- event against a GST-invoiced order, with taxable-value/CGST/SGST derived
-- proportionally to the original order's own tax ratio, and reports it
-- alongside original/net figures in the GST report and on the customer
-- receipt. It does NOT independently verify:
--   * Whether CGST Act s.34's time limits for issuing a credit note
--     (by the earlier of 30 Nov following the FY, or the annual return date)
--     are being respected — no expiry/deadline check exists.
--   * Multi-tax-rate proportionality precision beyond the single order-level
--     ratio described above (a café selling both 5%- and 18%-rate items in
--     the SAME refunded transaction gets an approximate, not exact, split).
--   * GSTR-1/GSTR-3B filing format compatibility — this is a report for a
--     café's own records and a document for their accountant, not a direct
--     government-portal export.
-- A GST-registered café should have their CA/GST practitioner review this
-- feature's output before relying on it for an actual return.
-- ============================================================================
