-- ============================================================================
-- 0031 — GST-compliant tax invoice for cafés that are GST-registered.
--
-- SCOPE, DELIBERATE: this covers a single dine-in/takeaway café selling to
-- walk-in customers (B2C) — every real order here is intra-state, so this
-- only ever produces CGST + SGST, never IGST. A café with no GSTIN keeps
-- getting today's plain receipt; nothing changes for it. Credit notes for
-- refunded orders (a distinct GST document, CGST Act s.34) are NOT built
-- here — flagged as a follow-up, not silently done or silently skipped.
--
-- WHAT THIS DOES NOT TOUCH: compute_bill()'s tax formula is unchanged. Tax
-- is computed on the base subtotal only, not on subtotal+service_charge —
-- that's pre-existing behaviour from before this migration, and changing it
-- would change the amount every future order charges a real customer. That's
-- a business decision for the café/its accountant, not something to change
-- silently inside an invoice-formatting migration. This migration only
-- labels and numbers whatever compute_bill already produced.
--
-- WHY A TRIGGER, NOT A NEW RPC: every existing settlement path (POS, tables
-- drawer, kitchen) marks an order paid via a direct `update orders set
-- payment_status = 'paid', ...` call from authenticated staff — there is no
-- single "settle_order()" choke point to hook into without a much bigger,
-- riskier refactor. A BEFORE UPDATE trigger fires no matter which of those
-- call sites caused the transition, exactly like enqueue_kot_jobs (0027)
-- already does for KOT tickets. Same proven pattern, not a new one.
-- ============================================================================

alter table cafes add column if not exists gst_sac_code text not null default '996331';
-- 996331 = "Services provided by Restaurants, Cafes and similar eating
-- facilities" under GST. Correct for virtually all café/restaurant orders
-- regardless of which specific food item was ordered — GST classifies
-- dine-in/takeaway food as a restaurant SERVICE, not item-wise goods, so
-- this is a café-level setting, not a per-menu-item one. Editable in
-- Settings in case a café's structure genuinely differs.

alter table orders add column if not exists gst_invoice_number text;
alter table orders add column if not exists gst_invoice_issued_at timestamptz;
-- Deliberately its own timestamp, not created_at (order placed) or done_at
-- (kitchen finished it) — an invoice's issue date is when it's actually
-- issued, i.e. when payment settles.

create index if not exists orders_gst_invoice_number_idx on orders (cafe_id, gst_invoice_number)
  where gst_invoice_number is not null;

-- ── Per-café, per-financial-year sequential counter ─────────────────────────
-- GST requires a consecutive serial number, unique per financial year — NOT
-- the daily-resetting short_code used for kitchen/floor display. A separate
-- table (not reusing short_code's counting logic) keeps the two concerns
-- apart: short_code can keep resetting daily for the KDS with zero risk of
-- ever colliding with or skipping a real invoice number.
create table if not exists gst_invoice_counters (
  cafe_id        uuid not null references cafes(id) on delete cascade,
  financial_year text not null,
  next_number    integer not null default 1,
  primary key (cafe_id, financial_year)
);

alter table gst_invoice_counters enable row level security;
-- No select/insert/update/delete policies at all, on purpose — same pattern
-- as refunds/cash_shifts. The only legitimate writer is
-- claim_gst_invoice_number() below, running as its owning role, not as the
-- calling user.
drop policy if exists "gst_invoice_counters read" on gst_invoice_counters;
create policy "gst_invoice_counters read" on gst_invoice_counters
  for select using (is_cafe_member(cafe_id));

-- India's financial year is 1 April – 31 March, evaluated in the café's own
-- timezone (not the server's) — reuses the same Intl-free `at time zone`
-- approach as cafe_day_start (0026) rather than a second timezone strategy.
create or replace function gst_financial_year(p_at timestamptz, p_tz text)
returns text language sql stable as $$
  select case
    when extract(month from (p_at at time zone p_tz)) >= 4
      then to_char(p_at at time zone p_tz, 'YY') || '-' || to_char((p_at at time zone p_tz) + interval '1 year', 'YY')
    else to_char((p_at at time zone p_tz) - interval '1 year', 'YY') || '-' || to_char(p_at at time zone p_tz, 'YY')
  end;
$$;

-- Atomic claim: INSERT ... ON CONFLICT DO UPDATE ... RETURNING serializes two
-- orders settling at the exact same instant on Postgres's row lock, so two
-- orders can never be issued the same number.
create or replace function claim_gst_invoice_number(p_cafe_id uuid, p_fy text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  insert into gst_invoice_counters (cafe_id, financial_year, next_number)
  values (p_cafe_id, p_fy, 2)
  on conflict (cafe_id, financial_year)
    do update set next_number = gst_invoice_counters.next_number + 1
  returning next_number - 1 into v_n;
  return v_n;
end $$;

revoke execute on function claim_gst_invoice_number(uuid, text) from public, anon, authenticated;

-- ── The trigger itself ──────────────────────────────────────────────────────
create or replace function assign_gst_invoice_number() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_gstin text;
  v_tz    text;
  v_fy    text;
  v_seq   int;
begin
  -- Idempotent: once assigned, never reassigned, even if payment_status
  -- bounces (e.g. paid -> refunded -> paid again on a re-settled order).
  if new.gst_invoice_number is not null then return new; end if;

  select gstin, timezone into v_gstin, v_tz from cafes where id = new.cafe_id;
  if v_gstin is null or v_gstin = '' then return new; end if; -- not GST-registered — plain receipt only, no invoice number

  v_fy := gst_financial_year(now(), coalesce(v_tz, 'Asia/Kolkata'));
  v_seq := claim_gst_invoice_number(new.cafe_id, v_fy);
  new.gst_invoice_number := 'INV/' || v_fy || '/' || lpad(v_seq::text, 6, '0');
  new.gst_invoice_issued_at := now();
  return new;
end $$;

drop trigger if exists trg_assign_gst_invoice_number on orders;
create trigger trg_assign_gst_invoice_number
  before update on orders
  for each row
  when (new.payment_status = 'paid' and old.payment_status is distinct from 'paid')
  execute function assign_gst_invoice_number();

-- ── get_receipt: add the GST invoice block when one exists ──────────────────
-- Extends the existing function (same one the customer-facing /r/[token]
-- page already calls) instead of adding a parallel get_gst_invoice() — this
-- IS the receipt; a GST invoice is the same document with extra legally-
-- required fields shown for a registered café, not a different document.
-- CGST/SGST split from the tax compute_bill already produced (see the note
-- at the top of this file for why that formula itself isn't touched here):
-- cgst = floor(tax/2), sgst = tax - cgst, so cgst+sgst always sums back to
-- the exact tax already charged, with no rounding drift.
create or replace function get_receipt(p_token uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'cafe', jsonb_build_object(
      'name', c.name, 'address', c.address, 'city', c.city,
      'gstin', c.gstin, 'logo_url', c.logo_url, 'phone', c.phone,
      'timezone', coalesce(c.timezone, 'Asia/Kolkata')),
    'order', jsonb_build_object(
      'short_code', o.short_code, 'created_at', o.created_at, 'status', o.status,
      'payment_status', o.payment_status, 'payment_method', o.payment_method,
      'subtotal', o.subtotal, 'discount', o.discount, 'tax', o.tax,
      'service_charge', o.service_charge, 'total', o.total,
      'coupon_code', o.coupon_code, 'table_label', t.label,
      'phone_masked', case when o.phone is not null then '******' || right(o.phone, 4) end),
    'gst_invoice', case when o.gst_invoice_number is not null then jsonb_build_object(
      'invoice_number', o.gst_invoice_number,
      'issued_at', o.gst_invoice_issued_at,
      'cgst', o.tax / 2,
      'sgst', o.tax - (o.tax / 2),
      'sac_code', c.gst_sac_code,
      'place_of_supply', coalesce(c.state, '') || case when c.gstin is not null then ' (' || left(c.gstin, 2) || ')' else '' end
    ) else null end,
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'name', i.name, 'qty', i.qty, 'price', i.price, 'modifiers', i.modifiers)), '[]'::jsonb)
      from order_items i where i.order_id = o.id)
  )
  from orders o
  join cafes c on c.id = o.cafe_id
  left join cafe_tables t on t.id = o.table_id
  where o.receipt_token = p_token;
$$;

grant execute on function get_receipt(uuid) to anon, authenticated;
