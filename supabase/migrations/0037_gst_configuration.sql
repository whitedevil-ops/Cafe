-- ============================================================================
-- 0037 — Real GST configuration, per-item tax rates, and inclusive pricing.
--
-- WHY GST "WASN'T WORKING" (root cause, found by tracing the whole path):
--   1. There was no way to say a café IS GST registered. 0031 inferred it
--      from `gstin` being non-null, and the ONLY place a GSTIN could be
--      entered was a single text box buried in the profile page's
--      "Business & bills" card. No legal name, trade name, state code,
--      invoice prefix, or inclusive/exclusive pricing existed at all.
--   2. `menu_items.tax_percent` has existed in schema.sql since day one and
--      was NEVER read by anything. Every order applied one flat café-level
--      rate to the whole subtotal, so a café selling items at different GST
--      slabs (5% food vs 18% packaged goods) could not be billed correctly.
--   3. The CGST/SGST split in 0031 only appeared once an order was settled
--      AND the café had a GSTIN — so most bills showed a single "Tax" line.
--
-- ARCHITECTURE DECISION: tax is computed ONCE, by one function
-- (apply_order_taxes), which both place_order and staff_place_order call
-- after inserting their line items. Tax rules are never duplicated across
-- the two engines. Rates and HSN/SAC are SNAPSHOTTED onto order_items at
-- insert time, exactly like `name` and `price` already are, so a historic
-- invoice can never change because someone edited the menu afterwards.
-- ============================================================================

-- ── Café-level GST registration + billing configuration ────────────────────
alter table cafes add column if not exists gst_registered  boolean not null default false;
alter table cafes add column if not exists legal_name      text;
alter table cafes add column if not exists trade_name      text;
alter table cafes add column if not exists state_code      text;
alter table cafes add column if not exists invoice_prefix  text not null default 'INV';
alter table cafes add column if not exists tax_inclusive   boolean not null default false;

-- Backfill deliberately generous: any café that already has a GSTIN OR is
-- already charging a non-zero tax_percent keeps charging exactly what it
-- charges today. Defaulting everyone to "not registered" would silently
-- zero the tax on live cafés — a real billing change dressed up as a
-- migration. Nobody's totals move as a result of this file.
update cafes
   set gst_registered = true
 where gst_registered = false
   and ((gstin is not null and trim(gstin) <> '') or coalesce(tax_percent, 0) > 0);

-- State code is the first 2 digits of the GSTIN (06 = Haryana, 27 = MH...).
-- Derived where a GSTIN already exists so nobody re-types it.
update cafes
   set state_code = left(gstin, 2)
 where state_code is null and gstin is not null and length(trim(gstin)) >= 2;

-- ── Per-item tax: the rate column already existed and was unused ───────────
-- menu_items.tax_percent stays NULLABLE on purpose: NULL means "use the
-- café's default rate". Only items that genuinely differ carry a value, so
-- changing the café default still moves everything that should move.
alter table menu_items add column if not exists hsn_sac text;

-- ── Tax snapshots on the line item ─────────────────────────────────────────
alter table order_items add column if not exists tax_percent   numeric(5,2);
alter table order_items add column if not exists taxable_value integer;
alter table order_items add column if not exists tax_amount    integer;
alter table order_items add column if not exists hsn_sac       text;

-- ── GSTIN format validation, server-side ───────────────────────────────────
-- 22AAAAA0000A1Z5: 2-digit state, 5 letters, 4 digits, 1 letter, 1 alnum,
-- literal 'Z', 1 check char. A format check only — it does NOT prove the
-- number is registered with the GST department.
create or replace function is_valid_gstin(p_gstin text)
returns boolean language sql immutable as $$
  select p_gstin is not null
     and upper(trim(p_gstin)) ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$';
$$;

-- ── THE canonical tax engine ───────────────────────────────────────────────
-- Called by both order engines after their line items exist. Computes, for
-- every line: its share of an order-level discount, its taxable value, and
-- its tax at that line's own rate — then writes the order totals.
--
-- Discount is allocated PROPORTIONALLY across lines, so a bill with mixed
-- GST slabs discounts each slab fairly instead of arbitrarily attributing
-- the whole discount to one rate (which would change the tax owed).
--
-- Inclusive pricing: the menu price already contains the tax, so taxable is
-- back-computed (value * 100 / (100 + rate)) and the total does NOT grow.
-- Exclusive pricing: tax is added on top. This is the difference between a
-- ₹100 item costing the guest ₹100 or ₹105, so it must be explicit.
create or replace function apply_order_taxes(p_order_id uuid, p_discount integer default 0)
returns table(subtotal integer, discount integer, tax integer, service_charge integer, total integer)
language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id    uuid;
  v_registered boolean;
  v_inclusive  boolean;
  v_default    numeric;
  v_svc_pct    numeric;
  v_subtotal   integer := 0;
  v_disc       integer := 0;
  v_tax        integer := 0;
  v_svc        integer := 0;
  v_total      integer := 0;
  v_line       record;
  v_line_val   integer;
  v_share      integer;
  v_taxable    integer;
  v_line_tax   integer;
  v_allocated  integer := 0;
  v_rows       integer;
  v_seen       integer := 0;
begin
  select o.cafe_id into v_cafe_id from orders o where o.id = p_order_id;
  if v_cafe_id is null then raise exception 'order not found'; end if;

  select c.gst_registered, c.tax_inclusive, coalesce(c.tax_percent, 0), coalesce(c.service_charge, 0)
    into v_registered, v_inclusive, v_default, v_svc_pct
    from cafes c where c.id = v_cafe_id;

  select coalesce(sum(oi.price * oi.qty), 0), count(*)
    into v_subtotal, v_rows
    from order_items oi where oi.order_id = p_order_id;

  v_disc := least(greatest(coalesce(p_discount, 0), 0), v_subtotal);

  for v_line in
    select oi.id, oi.price, oi.qty, oi.tax_percent
      from order_items oi where oi.order_id = p_order_id
      order by oi.id
  loop
    v_seen := v_seen + 1;
    v_line_val := v_line.price * v_line.qty;

    -- Last line absorbs the rounding remainder so the allocated discount
    -- sums to exactly v_disc and never drifts a rupee.
    if v_seen = v_rows then
      v_share := v_disc - v_allocated;
    elsif v_subtotal > 0 then
      v_share := round(v_disc::numeric * v_line_val / v_subtotal);
    else
      v_share := 0;
    end if;
    v_allocated := v_allocated + v_share;

    if not v_registered then
      -- Not GST registered: no tax is charged or shown, at all.
      v_taxable  := v_line_val - v_share;
      v_line_tax := 0;
    elsif v_inclusive then
      v_taxable  := round((v_line_val - v_share)::numeric * 100
                          / (100 + coalesce(v_line.tax_percent, v_default)));
      v_line_tax := (v_line_val - v_share) - v_taxable;
    else
      v_taxable  := v_line_val - v_share;
      v_line_tax := round(v_taxable::numeric * coalesce(v_line.tax_percent, v_default) / 100);
    end if;

    update order_items
       set taxable_value = v_taxable,
           tax_amount    = v_line_tax
     where id = v_line.id;

    v_tax := v_tax + v_line_tax;
  end loop;

  -- Service charge is calculated on the discounted value and is NOT part of
  -- the GST base (owner decision, 2026-07-23: GST applies to products only).
  v_svc := round((v_subtotal - v_disc)::numeric * v_svc_pct / 100);

  if v_inclusive and v_registered then
    v_total := (v_subtotal - v_disc) + v_svc;   -- tax already inside the price
  else
    v_total := (v_subtotal - v_disc) + v_tax + v_svc;
  end if;

  update orders
     set subtotal = v_subtotal, discount = v_disc, tax = v_tax,
         service_charge = v_svc, total = v_total
   where id = p_order_id;

  return query select v_subtotal, v_disc, v_tax, v_svc, v_total;
end $$;

revoke execute on function apply_order_taxes(uuid, integer) from public, anon;
grant execute on function apply_order_taxes(uuid, integer) to authenticated;

-- ── Snapshot the rate + HSN onto every new line item ───────────────────────
-- A trigger rather than editing the INSERT in both engines: it applies to
-- every writer automatically (including any future one) and cannot be
-- forgotten in one place. Only fills what the caller left NULL.
create or replace function snapshot_order_item_tax() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id uuid;
begin
  if new.tax_percent is not null and new.hsn_sac is not null then return new; end if;

  select o.cafe_id into v_cafe_id from orders o where o.id = new.order_id;
  if v_cafe_id is null then return new; end if;

  if new.tax_percent is null then
    select coalesce(mi.tax_percent, c.tax_percent)
      into new.tax_percent
      from cafes c
      left join menu_items mi on mi.id = new.menu_item_id
     where c.id = v_cafe_id;
  end if;

  if new.hsn_sac is null then
    select coalesce(mi.hsn_sac, c.gst_sac_code)
      into new.hsn_sac
      from cafes c
      left join menu_items mi on mi.id = new.menu_item_id
     where c.id = v_cafe_id;
  end if;

  return new;
end $$;

drop trigger if exists trg_snapshot_order_item_tax on order_items;
create trigger trg_snapshot_order_item_tax
  before insert on order_items
  for each row execute function snapshot_order_item_tax();

-- ── Only issue GST invoice numbers to registered cafés ─────────────────────
-- 0031 gated on `gstin is not null`; now that registration is explicit, use
-- it. Also honours the café's own invoice_prefix instead of hardcoding INV.
create or replace function assign_gst_invoice_number() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_registered boolean;
  v_gstin      text;
  v_prefix     text;
  v_tz         text;
  v_fy         text;
  v_seq        int;
begin
  if new.gst_invoice_number is not null then return new; end if;

  select gst_registered, gstin, coalesce(nullif(trim(invoice_prefix), ''), 'INV'), timezone
    into v_registered, v_gstin, v_prefix, v_tz
    from cafes where id = new.cafe_id;

  if not coalesce(v_registered, false) then return new; end if;
  if v_gstin is null or trim(v_gstin) = '' then return new; end if;

  v_fy  := gst_financial_year(now(), coalesce(v_tz, 'Asia/Kolkata'));
  v_seq := claim_gst_invoice_number(new.cafe_id, v_fy);
  new.gst_invoice_number     := v_prefix || '/' || v_fy || '/' || lpad(v_seq::text, 5, '0');
  new.gst_invoice_issued_at  := now();
  return new;
end $$;
