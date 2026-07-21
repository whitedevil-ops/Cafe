-- ============================================================================
-- counter — multi-tenant café SaaS schema
-- ----------------------------------------------------------------------------
-- Tenancy model: a "cafe" is the tenant. Every business row carries cafe_id.
-- Access is granted through cafe_members (user ↔ cafe ↔ role). RLS enforces
-- isolation at the DATABASE layer — the app layer never becomes the only guard.
--
-- Money: integer rupees (paise never needed for café pricing; avoids float drift).
-- Menu prices are COPIED into order_items so historic bills never mutate.
-- Loyalty balance is DERIVED from an append-only ledger, never hand-edited.
--
-- Anonymous QR ordering does NOT get broad anon write access. Customers read the
-- public menu (policies below) but orders are created by the Next.js server using
-- the service-role key, which bypasses RLS — see lib/db.ts. This keeps write paths
-- server-validated (prices, totals) per spec §45, and off the client bundle §35.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ── Enums ───────────────────────────────────────────────────────────────────
create type member_role   as enum ('owner','manager','cashier','kitchen','waiter','accountant');
create type order_status   as enum ('placed','accepted','preparing','ready','served','completed','cancelled');
create type order_type     as enum ('dine_in','takeaway','delivery');
create type payment_status as enum ('unpaid','paid','partial','refunded');
create type payment_method as enum ('cash','card','upi','split','counter');
create type table_status   as enum ('available','occupied','reserved','cleaning');
create type coupon_kind    as enum ('percent','flat','bogo','free_item','min_order');
create type ledger_kind    as enum ('earn','redeem','adjust','expire');

-- ── Identity ────────────────────────────────────────────────────────────────
-- Mirrors auth.users (managed by Supabase Auth). We never store passwords here.
create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  email      text,
  phone      text,
  created_at timestamptz not null default now()
);

-- ── Tenant ──────────────────────────────────────────────────────────────────
-- brand_id groups locations under one business so multi-location (§38) is a
-- non-breaking addition later: today one cafe == one brand.
create table cafes (
  id             uuid primary key default gen_random_uuid(),
  brand_id       uuid,
  owner_id       uuid not null references profiles(id),
  slug           text unique not null,
  name           text not null,
  business_type  text default 'cafe',
  phone          text,
  address        text,
  city           text,
  state          text,
  pincode        text,
  country        text not null default 'IN',
  gstin          text,
  fssai          text,
  logo_url       text,
  cover_url      text,
  brand_color    text default '#C2410C',
  currency       text not null default 'INR',
  timezone       text not null default 'Asia/Kolkata',
  dine_in        boolean not null default true,
  takeaway       boolean not null default true,
  delivery       boolean not null default false,
  tax_percent    numeric(5,2) not null default 5.00,
  service_charge numeric(5,2) not null default 0.00,
  plan           text not null default 'trial',
  upsell_threshold integer not null default 150,
  upi_id           text,                          -- café's UPI VPA for QR payments
  upi_name         text,
  created_at     timestamptz not null default now()
);

-- The tenant membership join — the heart of isolation.
create table cafe_members (
  cafe_id    uuid not null references cafes(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  role       member_role not null default 'owner',
  status     text not null default 'active',   -- active | invited | suspended
  invited_email text,
  created_at timestamptz not null default now(),
  primary key (cafe_id, user_id)
);

-- SECURITY DEFINER helper: bypasses RLS to answer "does the caller belong here?"
-- without the cafe_members policy recursively querying itself.
create or replace function is_cafe_member(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from cafe_members
    where cafe_id = target and user_id = auth.uid() and status = 'active'
  );
$$;

-- On Supabase Auth signup, mirror the new user into profiles automatically so a
-- profile row always exists before registration creates the café.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, phone)
  values (new.id,
          new.raw_user_meta_data->>'full_name',
          new.email,
          new.raw_user_meta_data->>'phone')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function handle_new_user();

create or replace function has_cafe_role(target uuid, roles member_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from cafe_members
    where cafe_id = target and user_id = auth.uid()
      and status = 'active' and role = any(roles)
  );
$$;

-- ── Menu ────────────────────────────────────────────────────────────────────
create table menu_categories (
  id         uuid primary key default gen_random_uuid(),
  cafe_id    uuid not null references cafes(id) on delete cascade,
  name       text not null,
  sort       integer not null default 0,
  archived   boolean not null default false,
  created_at timestamptz not null default now()
);

create table menu_items (
  id           uuid primary key default gen_random_uuid(),
  cafe_id      uuid not null references cafes(id) on delete cascade,
  category_id  uuid references menu_categories(id) on delete set null,
  name         text not null,
  description  text,
  price        integer not null check (price >= 0),
  tax_percent  numeric(5,2),
  image_url    text,
  available    boolean not null default true,
  is_veg       boolean,
  is_vegan     boolean not null default false,
  is_bestseller boolean not null default false,
  is_spicy     boolean not null default false,
  prep_minutes integer,
  sort         integer not null default 0,
  is_upsell    boolean not null default false,   -- powers the cart nudge (the wedge)
  upsell_pitch text,
  archived     boolean not null default false,
  created_at   timestamptz not null default now()
);

create table menu_item_variants (
  id           uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references menu_items(id) on delete cascade,
  name         text not null,                    -- Small / Medium / Large
  price_delta  integer not null default 0,       -- added to base price
  sort         integer not null default 0
);

create table menu_item_addons (
  id           uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references menu_items(id) on delete cascade,
  name         text not null,                    -- Extra shot / Oat milk
  price        integer not null default 0,
  sort         integer not null default 0
);

-- ── Tables ──────────────────────────────────────────────────────────────────
create table cafe_tables (
  id         uuid primary key default gen_random_uuid(),
  cafe_id    uuid not null references cafes(id) on delete cascade,
  label      text not null,
  capacity   integer,
  status     table_status not null default 'available',
  token      text unique not null,               -- opaque QR token, not the id
  created_at timestamptz not null default now()
);

-- ── Customers (CRM) ─────────────────────────────────────────────────────────
create table customers (
  id          uuid primary key default gen_random_uuid(),
  cafe_id     uuid not null references cafes(id) on delete cascade,
  name        text,
  phone       text,
  email       text,
  birthday    date,
  notes       text,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz,
  created_at  timestamptz not null default now(),
  unique (cafe_id, phone)
);

-- ── Orders ──────────────────────────────────────────────────────────────────
create table orders (
  id             uuid primary key default gen_random_uuid(),
  cafe_id        uuid not null references cafes(id) on delete cascade,
  table_id       uuid references cafe_tables(id) on delete set null,
  customer_id    uuid references customers(id) on delete set null,
  staff_id       uuid references profiles(id) on delete set null,
  short_code     text not null,                  -- per-cafe daily sequence
  type           order_type not null default 'dine_in',
  status         order_status not null default 'placed',
  payment_status payment_status not null default 'unpaid',
  payment_method payment_method,
  phone          text,                           -- anonymous QR customer's number
  subtotal       integer not null default 0,
  discount       integer not null default 0,
  tax            integer not null default 0,
  service_charge integer not null default 0,
  total          integer not null check (total >= 0),
  coupon_code    text,
  notes          text,
  -- Upsell instrumentation: the day-30 ROI argument, captured per order.
  upsell_shown   boolean not null default false,
  upsell_item_id uuid references menu_items(id) on delete set null,
  upsell_taken   boolean not null default false,
  upsell_value   integer not null default 0,
  created_at     timestamptz not null default now(),
  done_at        timestamptz
);

create table order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders(id) on delete cascade,
  menu_item_id uuid references menu_items(id) on delete set null,
  name         text not null,                    -- snapshot, not a join
  price        integer not null,
  qty          integer not null check (qty > 0),
  modifiers    jsonb not null default '[]',      -- [{name, price}] snapshot
  instructions text
);

-- ── Payments ────────────────────────────────────────────────────────────────
create table payments (
  id         uuid primary key default gen_random_uuid(),
  cafe_id    uuid not null references cafes(id) on delete cascade,
  order_id   uuid not null references orders(id) on delete cascade,
  method     payment_method not null,
  amount     integer not null check (amount >= 0),
  created_at timestamptz not null default now()
);

-- ── Loyalty (append-only ledger; balance is derived) ────────────────────────
create table loyalty_accounts (
  id          uuid primary key default gen_random_uuid(),
  cafe_id     uuid not null references cafes(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (cafe_id, customer_id)
);

create table loyalty_transactions (
  id         uuid primary key default gen_random_uuid(),
  cafe_id    uuid not null references cafes(id) on delete cascade,
  account_id uuid not null references loyalty_accounts(id) on delete cascade,
  order_id   uuid references orders(id) on delete set null,
  kind       ledger_kind not null,
  points     integer not null,                   -- +earn / -redeem, signed
  reason     text,
  created_at timestamptz not null default now()
);

create view v_loyalty_balance as
  select account_id, cafe_id, sum(points) as balance
  from loyalty_transactions group by account_id, cafe_id;

create table rewards (
  id           uuid primary key default gen_random_uuid(),
  cafe_id      uuid not null references cafes(id) on delete cascade,
  name         text not null,
  points_cost  integer not null check (points_cost > 0),
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ── Coupons ─────────────────────────────────────────────────────────────────
create table coupons (
  id             uuid primary key default gen_random_uuid(),
  cafe_id        uuid not null references cafes(id) on delete cascade,
  code           text not null,
  name           text,
  kind           coupon_kind not null,
  value          integer not null default 0,     -- percent (0-100) or flat rupees
  min_order      integer not null default 0,
  max_discount   integer,
  starts_at      timestamptz,
  ends_at        timestamptz,
  usage_limit    integer,
  per_customer   integer,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (cafe_id, code)
);

create table coupon_redemptions (
  id          uuid primary key default gen_random_uuid(),
  cafe_id     uuid not null references cafes(id) on delete cascade,
  coupon_id   uuid not null references coupons(id) on delete cascade,
  order_id    uuid references orders(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- ── Inventory (Phase 2 — clean tables now, recipes later) ───────────────────
create table inventory_items (
  id            uuid primary key default gen_random_uuid(),
  cafe_id       uuid not null references cafes(id) on delete cascade,
  name          text not null,
  sku           text,
  unit          text not null default 'unit',    -- kg / litre / unit
  current_stock numeric(12,3) not null default 0,
  min_stock     numeric(12,3) not null default 0,
  cost          integer,
  supplier      text,
  created_at    timestamptz not null default now()
);

create table inventory_transactions (
  id          uuid primary key default gen_random_uuid(),
  cafe_id     uuid not null references cafes(id) on delete cascade,
  item_id     uuid not null references inventory_items(id) on delete cascade,
  delta       numeric(12,3) not null,            -- signed
  reason      text,
  created_at  timestamptz not null default now()
);

-- ── Expenses (Phase 2) ──────────────────────────────────────────────────────
create table expenses (
  id          uuid primary key default gen_random_uuid(),
  cafe_id     uuid not null references cafes(id) on delete cascade,
  category    text not null,
  amount      integer not null check (amount >= 0),
  spent_on    date not null default current_date,
  vendor      text,
  method      payment_method,
  notes       text,
  receipt_url text,
  created_at  timestamptz not null default now()
);

-- ── Settings & audit ────────────────────────────────────────────────────────
-- One flexible settings row per cafe (receipts, loyalty rules, notifications).
create table cafe_settings (
  cafe_id    uuid primary key references cafes(id) on delete cascade,
  loyalty    jsonb not null default '{"earn_per_100":10,"min_spend":0,"expiry_days":365}',
  receipt    jsonb not null default '{}',
  notify     jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table audit_logs (
  id         uuid primary key default gen_random_uuid(),
  cafe_id    uuid not null references cafes(id) on delete cascade,
  actor_id   uuid references profiles(id) on delete set null,
  action     text not null,                      -- 'order.cancelled', 'role.changed'
  entity     text,
  entity_id  uuid,
  meta       jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ── Indexes (spec §34) ──────────────────────────────────────────────────────
create index on cafe_members     (user_id);
create index on menu_categories  (cafe_id, sort);
create index on menu_items       (cafe_id, category_id);
create index on cafe_tables      (cafe_id);
create index on customers        (cafe_id, last_seen desc);
create index on orders           (cafe_id, created_at desc);
create index on orders           (cafe_id, status);
create index on order_items      (order_id);
create index on payments         (cafe_id, order_id);
create index on loyalty_transactions (cafe_id, account_id);
create index on coupons          (cafe_id, code);
create index on expenses         (cafe_id, spent_on desc);
create index on audit_logs       (cafe_id, created_at desc);

-- ── Analytics views ─────────────────────────────────────────────────────────
create view v_upsell_impact as
select cafe_id,
  date_trunc('day', created_at)::date               as day,
  count(*)                                           as orders,
  round(avg(total))                                  as aov,
  round(avg(total) filter (where upsell_taken))      as aov_with_upsell,
  round(avg(total) filter (where not upsell_taken))  as aov_without_upsell,
  count(*) filter (where upsell_taken)               as upsells_taken,
  sum(upsell_value)                                  as upsell_revenue
from orders where status <> 'cancelled'
group by cafe_id, day;

-- ============================================================================
-- ROW LEVEL SECURITY
-- Staff tables: access only for active members of that cafe.
-- Public (QR) reads: cafe brand + menu + tables, so anon customers can order.
-- Order/payment WRITES: none from anon; the server (service role) handles them.
-- ============================================================================
alter table profiles              enable row level security;
alter table cafes                 enable row level security;
alter table cafe_members          enable row level security;
alter table menu_categories       enable row level security;
alter table menu_items            enable row level security;
alter table menu_item_variants    enable row level security;
alter table menu_item_addons      enable row level security;
alter table cafe_tables           enable row level security;
alter table customers             enable row level security;
alter table orders                enable row level security;
alter table order_items           enable row level security;
alter table payments              enable row level security;
alter table loyalty_accounts      enable row level security;
alter table loyalty_transactions  enable row level security;
alter table rewards               enable row level security;
alter table coupons               enable row level security;
alter table coupon_redemptions    enable row level security;
alter table inventory_items       enable row level security;
alter table inventory_transactions enable row level security;
alter table expenses              enable row level security;
alter table cafe_settings         enable row level security;
alter table audit_logs            enable row level security;

-- profiles: you can see/edit only yourself.
create policy "self read"   on profiles for select using (id = auth.uid());
create policy "self write"  on profiles for update using (id = auth.uid());
create policy "self insert" on profiles for insert with check (id = auth.uid());

-- cafes: members read; public reads the brand for the QR menu; owner updates.
create policy "member read"  on cafes for select using (is_cafe_member(id));
create policy "public brand" on cafes for select to anon using (true);
create policy "owner update"  on cafes for update using (has_cafe_role(id, array['owner','manager']::member_role[]));
-- Registration: an authenticated user creates a café they own. No prior membership
-- needed (that's the chicken-and-egg the bootstrap policy below resolves).
create policy "create own" on cafes for insert to authenticated with check (owner_id = auth.uid());
-- And they can read a café they own even before membership exists — needed for the
-- insert().select() read-back during onboarding, and for the owner generally.
create policy "owner read" on cafes for select to authenticated using (owner_id = auth.uid());

-- cafe_members: you see rows for cafes you belong to.
create policy "member read"   on cafe_members for select using (is_cafe_member(cafe_id));
-- Bootstrap: the café's owner may insert their OWN owner membership right after
-- creating the café. Without this, the first membership could never be written.
create policy "bootstrap owner" on cafe_members for insert to authenticated
  with check (user_id = auth.uid()
              and exists (select 1 from cafes c where c.id = cafe_id and c.owner_id = auth.uid()));
create policy "owner manage i" on cafe_members for insert with check (has_cafe_role(cafe_id, array['owner','manager']::member_role[]));
create policy "owner manage u" on cafe_members for update using (has_cafe_role(cafe_id, array['owner','manager']::member_role[]));
create policy "owner manage d" on cafe_members for delete using (has_cafe_role(cafe_id, array['owner']::member_role[]));

-- Menu + tables: members manage; anon reads (QR digital menu).
do $$
declare t text;
begin
  foreach t in array array['menu_categories','menu_items','menu_item_variants','menu_item_addons','cafe_tables']
  loop
    -- variants/addons key off the parent item's cafe via join, handled app-side;
    -- here we scope the top-level tables that carry cafe_id directly.
    if t in ('menu_categories','menu_items','cafe_tables') then
      execute format('create policy "member all" on %I for all using (is_cafe_member(cafe_id)) with check (is_cafe_member(cafe_id));', t);
      execute format('create policy "public read" on %I for select to anon using (true);', t);
    end if;
  end loop;
end $$;

-- variants/addons: readable by anyone (public menu), writable by members via app.
create policy "public read" on menu_item_variants for select using (true);
create policy "public read" on menu_item_addons   for select using (true);

-- Everything genuinely tenant-private: members only, no anon.
create policy "member all" on customers            for all using (is_cafe_member(cafe_id)) with check (is_cafe_member(cafe_id));
create policy "member all" on orders               for all using (is_cafe_member(cafe_id)) with check (is_cafe_member(cafe_id));
create policy "member all" on order_items          for all using (exists (select 1 from orders o where o.id = order_id and is_cafe_member(o.cafe_id))) with check (exists (select 1 from orders o where o.id = order_id and is_cafe_member(o.cafe_id)));
create policy "member all" on payments             for all using (is_cafe_member(cafe_id)) with check (is_cafe_member(cafe_id));
create policy "member all" on loyalty_accounts     for all using (is_cafe_member(cafe_id)) with check (is_cafe_member(cafe_id));
create policy "member all" on loyalty_transactions for all using (is_cafe_member(cafe_id)) with check (is_cafe_member(cafe_id));
create policy "member all" on rewards              for all using (is_cafe_member(cafe_id)) with check (is_cafe_member(cafe_id));
create policy "member all" on coupons              for all using (is_cafe_member(cafe_id)) with check (is_cafe_member(cafe_id));
create policy "member all" on coupon_redemptions   for all using (is_cafe_member(cafe_id)) with check (is_cafe_member(cafe_id));
create policy "member all" on inventory_items      for all using (is_cafe_member(cafe_id)) with check (is_cafe_member(cafe_id));
create policy "member all" on inventory_transactions for all using (is_cafe_member(cafe_id)) with check (is_cafe_member(cafe_id));
create policy "member all" on expenses             for all using (is_cafe_member(cafe_id)) with check (is_cafe_member(cafe_id));
create policy "member all" on cafe_settings        for all using (is_cafe_member(cafe_id)) with check (is_cafe_member(cafe_id));
create policy "member read" on audit_logs          for select using (is_cafe_member(cafe_id));

-- Realtime for the KDS / live orders.
alter publication supabase_realtime add table orders;
