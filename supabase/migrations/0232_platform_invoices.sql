-- ============================================================================
-- 0232 — manual invoice generation for KhaoPiyo subscriptions, Ops-Admin-only.
--
-- Ventron currently takes payment for KhaoPiyo subscriptions by personal UPI,
-- outside any payment gateway (platform_plans.razorpay_plan_id is null on
-- every plan — confirmed live, there is no real Razorpay Subscription wiring
-- today). Nothing in the product could produce a paper trail for that money.
-- This adds exactly one thing: a durable, admin-authored invoice record an
-- Ops admin fills in and generates by hand after confirming a payment
-- themselves — never auto-marked paid, never inferred from any webhook.
--
-- Reuses the existing models rather than inventing a parallel customer/
-- subscription system: cafe_id points at the real cafés table, and every
-- billing-relevant field (name, address, GSTIN, plan, subscription window)
-- is PRE-FILLED from there by op_get_invoice_prefill. But it is then SNAPSHOT
-- onto the invoice row at generation time, not read live from cafes/
-- platform_plans on every view — an invoice has to keep showing exactly what
-- it said when issued even if the café's address or plan changes afterward,
-- the same reason gst_invoices/order_items snapshot pricing/tax rather than
-- joining live.
-- ============================================================================

create table if not exists platform_invoice_counters (
  year     integer primary key,
  next_seq integer not null default 1
);
alter table platform_invoice_counters enable row level security;
create policy "admin all" on platform_invoice_counters for all using (is_platform_admin()) with check (is_platform_admin());
revoke all on platform_invoice_counters from public, anon, authenticated;

create table if not exists platform_invoices (
  id                 uuid primary key default gen_random_uuid(),
  invoice_number     text not null unique,
  cafe_id            uuid not null references cafes(id),

  -- Snapshot, not a live join — see header.
  customer_name      text not null,
  customer_phone     text,
  customer_email     text,
  billing_address    text,
  billing_city       text,
  billing_state      text,
  billing_pincode    text,
  billing_country    text not null default 'India',
  gstin              text,

  plan_key           text not null,
  plan_name          text not null,
  subscription_start date,
  subscription_end   date,

  amount             numeric not null,
  discount           numeric not null default 0,
  tax                numeric not null default 0,
  grand_total        numeric not null,

  payment_method     text,
  payment_date       date,
  payment_reference  text,
  -- 'paid' is only ever set because an admin looked at their own UPI app and
  -- typed it in — nothing in this migration or its RPCs can set this value
  -- on its own.
  payment_status     text not null default 'pending' check (payment_status in ('pending', 'paid', 'partial', 'failed')),

  notes              text,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now()
);

create index if not exists platform_invoices_cafe_id_idx on platform_invoices (cafe_id);
create index if not exists platform_invoices_created_at_idx on platform_invoices (created_at desc);

alter table platform_invoices enable row level security;
-- Coarse gate only — is_platform_admin() covers "some kind of platform
-- admin", same layered pattern as cafe_feature_overrides: the specific
-- has_platform_permission() check for subscriptions.view/manage happens
-- inside each RPC below, not in this policy.
create policy "admin all" on platform_invoices for all using (is_platform_admin()) with check (is_platform_admin());
revoke all on platform_invoices from public, anon, authenticated;

-- ── Prefill data for the "Generate Invoice" form ────────────────────────────
create or replace function op_get_invoice_prefill(p_cafe_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not has_platform_permission('subscriptions.manage') then
    raise exception 'not authorized';
  end if;

  select jsonb_build_object(
    'cafe_id', c.id,
    'customer_name', c.name,
    'customer_phone', coalesce(c.phone, p.phone),
    'customer_email', coalesce(c.email, p.email),
    'billing_address', c.address,
    'billing_city', c.city,
    'billing_state', c.state,
    'billing_pincode', c.pincode,
    'billing_country', coalesce(c.country, 'India'),
    'gstin', c.gstin,
    'gst_registered', coalesce(c.gst_registered, false),
    'plan_key', c.plan,
    'plan_name', coalesce(pp.name, c.plan),
    'plan_price_monthly', pp.price_monthly,
    'plan_price_yearly', pp.price_yearly,
    -- No separate billing-start date is stored anywhere in the product (the
    -- payments tab in cafe-detail-client.tsx notes the same gap and uses
    -- created_at as the closest real signal) — the form pre-fills this and
    -- the admin can correct it before generating.
    'subscription_start', c.created_at,
    'subscription_end', c.subscription_ends_at,
    'billing_status', c.billing_status
  ) into v_result
  from cafes c
  left join profiles p on p.id = c.owner_id
  left join platform_plans pp on pp.key = c.plan
  where c.id = p_cafe_id;

  if v_result is null then raise exception 'café not found'; end if;
  return v_result;
end $$;

revoke execute on function op_get_invoice_prefill(uuid) from public, anon;
grant execute on function op_get_invoice_prefill(uuid) to authenticated;

-- ── Generate an invoice ──────────────────────────────────────────────────
create or replace function op_generate_invoice(
  p_cafe_id            uuid,
  p_customer_name      text,
  p_customer_phone     text,
  p_customer_email     text,
  p_billing_address    text,
  p_billing_city       text,
  p_billing_state      text,
  p_billing_pincode    text,
  p_billing_country    text,
  p_gstin              text,
  p_plan_key           text,
  p_plan_name          text,
  p_subscription_start date,
  p_subscription_end   date,
  p_amount             numeric,
  p_discount           numeric,
  p_tax                numeric,
  p_grand_total        numeric,
  p_payment_method     text,
  p_payment_date       date,
  p_payment_reference  text,
  p_payment_status     text,
  p_notes              text
)
returns platform_invoices language plpgsql security definer set search_path = public as $$
declare
  v_year    int;
  v_seq     int;
  v_number  text;
  v_row     platform_invoices;
begin
  if not has_platform_permission('subscriptions.manage') then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from cafes where id = p_cafe_id) then
    raise exception 'café not found';
  end if;
  if coalesce(trim(p_customer_name), '') = '' then
    raise exception 'customer name is required';
  end if;
  if p_payment_status not in ('pending', 'paid', 'partial', 'failed') then
    raise exception 'invalid payment status: %', p_payment_status;
  end if;

  v_year := extract(year from now())::int;
  -- Atomic per-year counter: a fresh year inserts starting at 2 and hands
  -- back 1; an existing year increments and hands back the pre-increment
  -- value — either way the row is left holding the NEXT number to give out,
  -- and the single statement's row-level lock is what makes two concurrent
  -- generate calls in the same year get two different sequence numbers
  -- rather than a race onto the same one.
  insert into platform_invoice_counters (year, next_seq) values (v_year, 2)
    on conflict (year) do update set next_seq = platform_invoice_counters.next_seq + 1
    returning next_seq - 1 into v_seq;
  v_number := 'VNT-KP-' || v_year || '-' || lpad(v_seq::text, 4, '0');

  insert into platform_invoices (
    invoice_number, cafe_id, customer_name, customer_phone, customer_email,
    billing_address, billing_city, billing_state, billing_pincode, billing_country, gstin,
    plan_key, plan_name, subscription_start, subscription_end,
    amount, discount, tax, grand_total,
    payment_method, payment_date, payment_reference, payment_status,
    notes, created_by
  ) values (
    v_number, p_cafe_id, trim(p_customer_name), nullif(trim(p_customer_phone), ''), nullif(trim(p_customer_email), ''),
    nullif(trim(p_billing_address), ''), nullif(trim(p_billing_city), ''), nullif(trim(p_billing_state), ''),
    nullif(trim(p_billing_pincode), ''), coalesce(nullif(trim(p_billing_country), ''), 'India'), nullif(trim(p_gstin), ''),
    p_plan_key, p_plan_name, p_subscription_start, p_subscription_end,
    p_amount, coalesce(p_discount, 0), coalesce(p_tax, 0), p_grand_total,
    nullif(trim(p_payment_method), ''), p_payment_date, nullif(trim(p_payment_reference), ''), p_payment_status,
    nullif(trim(p_notes), ''), auth.uid()
  )
  returning * into v_row;

  insert into platform_audit_logs (actor_id, action, target_type, target_id, new_value)
  values (auth.uid(), 'cafe.invoice_generated', 'cafe', p_cafe_id,
          jsonb_build_object('invoice_number', v_number, 'grand_total', p_grand_total, 'payment_status', p_payment_status));

  return v_row;
end $$;

revoke execute on function op_generate_invoice(uuid, text, text, text, text, text, text, text, text, text, text, text, date, date, numeric, numeric, numeric, numeric, text, date, text, text, text) from public, anon;
grant execute on function op_generate_invoice(uuid, text, text, text, text, text, text, text, text, text, text, text, date, date, numeric, numeric, numeric, numeric, text, date, text, text, text) to authenticated;

-- ── List + fetch, for Ops Admin → Billing → Invoices ────────────────────────
create or replace function op_list_invoices(p_search text default null, p_limit int default 50)
returns table (
  id uuid, invoice_number text, cafe_id uuid, cafe_name text, customer_name text,
  plan_name text, grand_total numeric, payment_status text, created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_platform_permission('subscriptions.view') then
    raise exception 'not authorized';
  end if;

  return query
    select i.id, i.invoice_number, i.cafe_id, c.name, i.customer_name,
           i.plan_name, i.grand_total, i.payment_status, i.created_at
    from platform_invoices i
    join cafes c on c.id = i.cafe_id
    where p_search is null or p_search = '' or
          i.invoice_number ilike '%' || p_search || '%' or
          i.customer_name ilike '%' || p_search || '%' or
          c.name ilike '%' || p_search || '%'
    order by i.created_at desc
    limit greatest(coalesce(p_limit, 50), 1);
end $$;

revoke execute on function op_list_invoices(text, int) from public, anon;
grant execute on function op_list_invoices(text, int) to authenticated;

create or replace function op_get_invoice(p_invoice_id uuid)
returns platform_invoices language plpgsql stable security definer set search_path = public as $$
declare v_row platform_invoices;
begin
  if not has_platform_permission('subscriptions.view') then
    raise exception 'not authorized';
  end if;
  select * into v_row from platform_invoices where id = p_invoice_id;
  if v_row is null then raise exception 'invoice not found'; end if;
  return v_row;
end $$;

revoke execute on function op_get_invoice(uuid) from public, anon;
grant execute on function op_get_invoice(uuid) to authenticated;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'platform_invoices') then
    raise exception 'platform_invoices table was not created';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'platform_invoice_counters') then
    raise exception 'platform_invoice_counters table was not created';
  end if;
  if not exists (select 1 from pg_proc where proname = 'op_generate_invoice') then
    raise exception 'op_generate_invoice does not exist';
  end if;
  if not exists (select 1 from pg_proc where proname = 'op_get_invoice_prefill') then
    raise exception 'op_get_invoice_prefill does not exist';
  end if;
  if not exists (select 1 from pg_proc where proname = 'op_list_invoices') then
    raise exception 'op_list_invoices does not exist';
  end if;
  if not exists (select 1 from pg_proc where proname = 'op_get_invoice') then
    raise exception 'op_get_invoice does not exist';
  end if;
  if not exists (
    select 1 from information_schema.table_constraints
    where table_name = 'platform_invoices' and constraint_type = 'UNIQUE'
  ) then
    raise exception 'platform_invoices.invoice_number is missing its unique constraint';
  end if;
end $$;
