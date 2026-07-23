-- ============================================================================
-- 0027 — OPTIONAL KOT printing, built as an adapter around the existing order
-- engine rather than inside it.
--
-- THE LOAD-BEARING DECISION: print jobs are enqueued by a TRIGGER on orders,
-- not by place_order/staff_place_order. Two consequences, both deliberate:
--   1. Neither order-creation function is modified at all. They remain the
--      single canonical path and carry zero printer awareness.
--   2. The trigger body is wrapped in an exception handler that swallows
--      everything. A misconfigured printer, a bad payload, a dropped station —
--      none of it can roll back an order. Ordering and the digital KDS are the
--      source of truth; printing is a downstream side effect.
--
--        Canonical Order  ──►  orders row committed
--              │
--              ├──► Digital KDS         (always, unchanged)
--              ├──► Customer tracker    (always, unchanged)
--              └──► print_jobs          (only if that café enabled it)
--
-- NOT BUILT HERE, and deliberately so: any ESC/POS byte generation or
-- printer-model-specific protocol. Payloads are structured JSON describing
-- WHAT to print. A local bridge decides HOW. That keeps adding a second
-- printer brand a bridge concern, not a schema migration.
-- ============================================================================

-- ── Kitchen stations ───────────────────────────────────────────────────────
-- Optional. A café with no stations still prints fine: a printer with a NULL
-- station receives every item, which is the single-printer case.
create table if not exists kitchen_stations (
  id         uuid primary key default gen_random_uuid(),
  cafe_id    uuid not null references cafes(id) on delete cascade,
  name       text not null,
  sort       integer not null default 0,
  created_at timestamptz not null default now(),
  unique (cafe_id, name)
);
alter table kitchen_stations enable row level security;
drop policy if exists "member all" on kitchen_stations;
create policy "member all" on kitchen_stations for all
  using (is_cafe_member(cafe_id)) with check (is_cafe_member(cafe_id));

-- Routing lives on the CATEGORY, not the item: an owner thinks "Coffee goes to
-- the coffee station", and category-level mapping is one decision instead of
-- one per item across a 300-item menu.
alter table menu_categories add column if not exists station_id uuid references kitchen_stations(id) on delete set null;

-- ── Café-level switch. Default OFF, per the product rule. ──────────────────
alter table cafes add column if not exists kot_printing_enabled boolean not null default false;

-- ── Printers ───────────────────────────────────────────────────────────────
create table if not exists kot_printers (
  id              uuid primary key default gen_random_uuid(),
  cafe_id         uuid not null references cafes(id) on delete cascade,
  name            text not null,
  connection_type text not null default 'lan',
  ip_address      text,
  port            integer default 9100,
  paper_width     text not null default '80mm',
  station_id      uuid references kitchen_stations(id) on delete set null, -- null = every item
  auto_print      boolean not null default true,
  copies          integer not null default 1 check (copies between 1 and 5),
  enabled         boolean not null default true,
  last_seen_at    timestamptz,     -- heartbeat from the bridge
  last_error      text,
  created_at      timestamptz not null default now()
);

do $$ begin
  alter table kot_printers add constraint kot_printers_conn_chk
    check (connection_type in ('lan', 'usb', 'bluetooth'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table kot_printers add constraint kot_printers_paper_chk
    check (paper_width in ('58mm', '80mm'));
exception when duplicate_object then null; end $$;

create index if not exists kot_printers_cafe_idx on kot_printers (cafe_id, enabled);

alter table kot_printers enable row level security;
drop policy if exists "member all" on kot_printers;
create policy "member all" on kot_printers for all
  using (is_cafe_member(cafe_id)) with check (is_cafe_member(cafe_id));

-- ── Print jobs ─────────────────────────────────────────────────────────────
do $$ begin
  create type print_job_status as enum ('pending', 'printing', 'printed', 'failed');
exception when duplicate_object then null; end $$;

create table if not exists print_jobs (
  id           uuid primary key default gen_random_uuid(),
  cafe_id      uuid not null references cafes(id) on delete cascade,
  order_id     uuid references orders(id) on delete cascade,
  printer_id   uuid references kot_printers(id) on delete cascade,
  station_id   uuid references kitchen_stations(id) on delete set null,
  kind         text not null default 'kot',        -- kot | reprint | test
  payload      jsonb not null,
  status       print_job_status not null default 'pending',
  attempts     integer not null default 0,
  error        text,
  requested_by uuid references profiles(id) on delete set null,  -- null = automatic
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  completed_at timestamptz
);
create index if not exists print_jobs_queue_idx on print_jobs (cafe_id, status, created_at);
create index if not exists print_jobs_order_idx on print_jobs (order_id);

alter table print_jobs enable row level security;
drop policy if exists "member read" on print_jobs;
create policy "member read" on print_jobs for select using (is_cafe_member(cafe_id));
-- No member INSERT/UPDATE policy: jobs are created by the trigger and by
-- SECURITY DEFINER functions, and advanced only by the bridge API (which uses
-- its own token, never a Supabase key). Staff cannot forge or rewrite history.

-- ── Bridge tokens ──────────────────────────────────────────────────────────
-- The local print bridge authenticates with one of these, NOT with a Supabase
-- key. Stored hashed, so a database leak does not hand out working bridges.
-- Scoped to exactly one café — a bridge can never see another café's jobs.
create table if not exists print_bridge_tokens (
  id           uuid primary key default gen_random_uuid(),
  cafe_id      uuid not null references cafes(id) on delete cascade,
  name         text not null default 'Print bridge',
  token_hash   text not null unique,
  last_seen_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);
alter table print_bridge_tokens enable row level security;
drop policy if exists "member read" on print_bridge_tokens;
-- Members may see that a bridge exists (name, last seen) but the hash is
-- useless and the raw token is shown exactly once, at creation.
create policy "member read" on print_bridge_tokens for select using (is_cafe_member(cafe_id));

-- ── KOT payload builder ────────────────────────────────────────────────────
-- Returns WHAT to print as structured data. No ESC/POS, no column widths, no
-- font codes: those are the bridge's job, which is what lets a second printer
-- brand be added without touching the database.
--
-- Prices, taxes and totals are deliberately absent — a KOT is a kitchen
-- instruction, not a bill.
create or replace function build_kot_payload(p_order_id uuid, p_printer_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_order    record;
  v_printer  record;
  v_items    jsonb;
begin
  select o.id, o.short_code, o.source, o.notes, o.created_at, o.cafe_id, o.type,
         t.label as table_label, c.timezone
    into v_order
    from orders o
    join cafes c on c.id = o.cafe_id
    left join cafe_tables t on t.id = o.table_id
   where o.id = p_order_id;
  if v_order.id is null then return null; end if;

  select * into v_printer from kot_printers where id = p_printer_id;
  if v_printer.id is null then return null; end if;

  -- A printer bound to a station takes only that station's items. An unbound
  -- printer takes everything, which is the single-printer café.
  select coalesce(jsonb_agg(jsonb_build_object(
           'qty', oi.qty,
           'name', oi.name,
           'modifiers', coalesce((select jsonb_agg(m->>'name') from jsonb_array_elements(oi.modifiers) m), '[]'::jsonb),
           'note', oi.instructions
         ) order by oi.id), '[]'::jsonb)
    into v_items
    from order_items oi
    left join menu_items mi on mi.id = oi.menu_item_id
    left join menu_categories mc on mc.id = mi.category_id
   where oi.order_id = p_order_id
     and (v_printer.station_id is null or mc.station_id = v_printer.station_id);

  -- Nothing for this station: no job, rather than a blank ticket.
  if jsonb_array_length(v_items) = 0 then return null; end if;

  return jsonb_build_object(
    'kot_number', v_order.short_code,
    'order_id', v_order.id,
    'table_label', v_order.table_label,
    'order_type', v_order.type,
    'source', v_order.source,
    'placed_at', v_order.created_at,
    'timezone', coalesce(v_order.timezone, 'Asia/Kolkata'),
    'station', (select name from kitchen_stations where id = v_printer.station_id),
    'paper_width', v_printer.paper_width,
    'copies', v_printer.copies,
    'items', v_items,
    'order_note', nullif(trim(coalesce(v_order.notes, '')), '')
  );
end $$;

revoke execute on function build_kot_payload(uuid, uuid) from public, anon;
grant execute on function build_kot_payload(uuid, uuid) to authenticated;

-- ── The adapter: enqueue on order finalisation ─────────────────────────────
-- Fires on the single UPDATE that both order-creation paths perform once every
-- line item is inserted and the total is computed — the earliest moment a
-- complete ticket can be built.
create or replace function enqueue_kot_jobs() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_enabled boolean;
  v_printer record;
  v_payload jsonb;
begin
  -- Everything below is best-effort. Printing must NEVER fail an order.
  begin
    select kot_printing_enabled into v_enabled from cafes where id = new.cafe_id;
    if not coalesce(v_enabled, false) then return new; end if;

    -- Idempotency: a later UPDATE to this order must not reprint it.
    if exists (select 1 from print_jobs where order_id = new.id and kind = 'kot') then
      return new;
    end if;

    for v_printer in
      select * from kot_printers
       where cafe_id = new.cafe_id and enabled = true and auto_print = true
    loop
      v_payload := build_kot_payload(new.id, v_printer.id);
      if v_payload is not null then
        insert into print_jobs (cafe_id, order_id, printer_id, station_id, kind, payload)
        values (new.cafe_id, new.id, v_printer.id, v_printer.station_id, 'kot', v_payload);
      end if;
    end loop;
  exception when others then
    -- Swallowed on purpose. The order is already committed and on the KDS;
    -- a printing problem is surfaced in the UI, never by losing the order.
    null;
  end;
  return new;
end $$;

drop trigger if exists trg_orders_enqueue_kot on orders;
create trigger trg_orders_enqueue_kot
  after update on orders
  for each row
  when (old.total is distinct from new.total and new.total > 0)
  execute function enqueue_kot_jobs();

-- ── Reprint ────────────────────────────────────────────────────────────────
-- Creates a NEW print job. Never touches the order, so a reprint can never
-- duplicate an order or alter revenue.
create or replace function reprint_kot(p_order_id uuid, p_printer_id uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id uuid;
  v_printer record;
  v_payload jsonb;
  v_count   integer := 0;
begin
  select cafe_id into v_cafe_id from orders where id = p_order_id;
  if v_cafe_id is null then raise exception 'order not found'; end if;

  if not has_cafe_role(v_cafe_id, array['owner','manager','cashier','kitchen']::member_role[]) then
    raise exception 'you do not have permission to reprint';
  end if;

  for v_printer in
    select * from kot_printers
     where cafe_id = v_cafe_id and enabled = true
       and (p_printer_id is null or id = p_printer_id)
  loop
    v_payload := build_kot_payload(p_order_id, v_printer.id);
    if v_payload is not null then
      insert into print_jobs (cafe_id, order_id, printer_id, station_id, kind, payload, requested_by)
      values (v_cafe_id, p_order_id, v_printer.id, v_printer.station_id, 'reprint', v_payload, auth.uid());
      v_count := v_count + 1;
    end if;
  end loop;

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (v_cafe_id, auth.uid(), 'kot.reprinted', 'orders', p_order_id,
          jsonb_build_object('jobs', v_count, 'printer_id', p_printer_id));

  return v_count;
end $$;

revoke execute on function reprint_kot(uuid, uuid) from public, anon;
grant execute on function reprint_kot(uuid, uuid) to authenticated;

-- ── Retry a failed job (no new ticket, same job re-queued) ─────────────────
create or replace function retry_print_job(p_job_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_cafe_id uuid;
begin
  select cafe_id into v_cafe_id from print_jobs where id = p_job_id;
  if v_cafe_id is null then raise exception 'job not found'; end if;
  if not is_cafe_member(v_cafe_id) then raise exception 'not authorized'; end if;

  update print_jobs
     set status = 'pending', error = null, started_at = null, completed_at = null
   where id = p_job_id and status = 'failed';
end $$;

revoke execute on function retry_print_job(uuid) from public, anon;
grant execute on function retry_print_job(uuid) to authenticated;

-- ── Test print ─────────────────────────────────────────────────────────────
create or replace function test_print(p_printer_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_printer record; v_job uuid;
begin
  select * into v_printer from kot_printers where id = p_printer_id;
  if v_printer.id is null then raise exception 'printer not found'; end if;
  if not is_cafe_member(v_printer.cafe_id) then raise exception 'not authorized'; end if;

  insert into print_jobs (cafe_id, printer_id, station_id, kind, payload, requested_by)
  values (v_printer.cafe_id, v_printer.id, v_printer.station_id, 'test',
          jsonb_build_object(
            'kot_number', 'TEST',
            'placed_at', now(),
            'timezone', (select coalesce(timezone,'Asia/Kolkata') from cafes where id = v_printer.cafe_id),
            'paper_width', v_printer.paper_width,
            'copies', 1,
            'station', (select name from kitchen_stations where id = v_printer.station_id),
            'items', jsonb_build_array(jsonb_build_object(
              'qty', 1, 'name', 'Test print — KhaoPiyo', 'modifiers', '[]'::jsonb, 'note', null)),
            'order_note', 'If you can read this, the printer is configured correctly.'
          ), auth.uid())
  returning id into v_job;
  return v_job;
end $$;

revoke execute on function test_print(uuid) from public, anon;
grant execute on function test_print(uuid) to authenticated;

-- ── Bridge token issuance ──────────────────────────────────────────────────
-- Returns the raw token exactly once; only its hash is stored. search_path
-- includes `extensions` because Supabase installs pgcrypto there — omitting it
-- is what broke the OTP functions in 0023.
create or replace function issue_print_bridge_token(p_cafe_id uuid, p_name text default 'Print bridge')
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_token text;
begin
  if not has_cafe_role(p_cafe_id, array['owner','manager']::member_role[]) then
    raise exception 'only an owner or manager can pair a print bridge';
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into print_bridge_tokens (cafe_id, name, token_hash)
  values (p_cafe_id, coalesce(nullif(trim(p_name), ''), 'Print bridge'),
          encode(digest(v_token, 'sha256'), 'hex'));

  insert into audit_logs (cafe_id, actor_id, action, entity, meta)
  values (p_cafe_id, auth.uid(), 'print_bridge.paired', 'print_bridge_tokens',
          jsonb_build_object('name', p_name));

  return v_token;
end $$;

revoke execute on function issue_print_bridge_token(uuid, text) from public, anon;
grant execute on function issue_print_bridge_token(uuid, text) to authenticated;

create or replace function revoke_print_bridge_token(p_token_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_cafe_id uuid;
begin
  select cafe_id into v_cafe_id from print_bridge_tokens where id = p_token_id;
  if v_cafe_id is null then raise exception 'token not found'; end if;
  if not has_cafe_role(v_cafe_id, array['owner','manager']::member_role[]) then
    raise exception 'only an owner or manager can revoke a print bridge';
  end if;

  update print_bridge_tokens set revoked_at = now() where id = p_token_id;
  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (v_cafe_id, auth.uid(), 'print_bridge.revoked', 'print_bridge_tokens', p_token_id, '{}'::jsonb);
end $$;

revoke execute on function revoke_print_bridge_token(uuid) from public, anon;
grant execute on function revoke_print_bridge_token(uuid) to authenticated;

-- ── Bridge-side operations, all keyed by the bridge token ──────────────────
-- Called only from the server-side API route. Each resolves the token to
-- exactly one cafe_id and filters by it, so cross-tenant access is impossible
-- even if a token leaks.
create or replace function bridge_claim_jobs(p_token text, p_limit integer default 10)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_cafe_id uuid;
  v_hash    text;
  v_jobs    jsonb;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'invalid bridge token'; end if;
  v_hash := encode(digest(p_token, 'sha256'), 'hex');

  select cafe_id into v_cafe_id from print_bridge_tokens
   where token_hash = v_hash and revoked_at is null;
  if v_cafe_id is null then raise exception 'invalid bridge token'; end if;

  update print_bridge_tokens set last_seen_at = now() where token_hash = v_hash;

  -- Claim atomically so two bridges on the same café cannot print twice.
  with claimed as (
    update print_jobs
       set status = 'printing', started_at = now(), attempts = attempts + 1
     where id in (
       select id from print_jobs
        where cafe_id = v_cafe_id and status = 'pending'
        order by created_at
        limit greatest(coalesce(p_limit, 10), 1)
        for update skip locked
     )
     returning id, printer_id, payload
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'job_id', c.id,
           'printer', jsonb_build_object(
             'id', p.id, 'name', p.name, 'connection_type', p.connection_type,
             'ip_address', p.ip_address, 'port', p.port, 'paper_width', p.paper_width),
           'document', c.payload
         )), '[]'::jsonb)
    into v_jobs
    from claimed c
    left join kot_printers p on p.id = c.printer_id;

  return jsonb_build_object('cafe_id', v_cafe_id, 'jobs', v_jobs);
end $$;

revoke execute on function bridge_claim_jobs(text, integer) from public, anon, authenticated;
grant execute on function bridge_claim_jobs(text, integer) to service_role;

create or replace function bridge_report_job(p_token text, p_job_id uuid, p_ok boolean, p_error text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_cafe_id uuid; v_hash text; v_printer uuid;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'invalid bridge token'; end if;
  v_hash := encode(digest(p_token, 'sha256'), 'hex');

  select cafe_id into v_cafe_id from print_bridge_tokens
   where token_hash = v_hash and revoked_at is null;
  if v_cafe_id is null then raise exception 'invalid bridge token'; end if;

  -- cafe_id in the WHERE clause is the tenant guard: a bridge can only ever
  -- report on jobs belonging to its own café.
  update print_jobs
     set status = case when p_ok then 'printed' else 'failed' end::print_job_status,
         error = case when p_ok then null else left(coalesce(p_error, 'print failed'), 300) end,
         completed_at = now()
   where id = p_job_id and cafe_id = v_cafe_id
  returning printer_id into v_printer;

  if v_printer is not null then
    update kot_printers
       set last_seen_at = now(),
           last_error = case when p_ok then null else left(coalesce(p_error, 'print failed'), 300) end
     where id = v_printer;
  end if;
end $$;

revoke execute on function bridge_report_job(text, uuid, boolean, text) from public, anon, authenticated;
grant execute on function bridge_report_job(text, uuid, boolean, text) to service_role;

-- ── Printer health, for the KDS banner ─────────────────────────────────────
create or replace function printer_health(p_cafe_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_cafe_member(p_cafe_id) then raise exception 'not authorized'; end if;

  return jsonb_build_object(
    'enabled', (select coalesce(kot_printing_enabled, false) from cafes where id = p_cafe_id),
    'bridge_last_seen', (select max(last_seen_at) from print_bridge_tokens
                          where cafe_id = p_cafe_id and revoked_at is null),
    -- Computed here rather than in the browser: a kitchen tablet with a wrong
    -- clock would otherwise report a healthy bridge as offline (or worse, the
    -- reverse). The server's clock is the only one that matters.
    'bridge_online', (select coalesce(max(last_seen_at) > now() - interval '2 minutes', false)
                        from print_bridge_tokens
                       where cafe_id = p_cafe_id and revoked_at is null),
    'failed_jobs', (select count(*) from print_jobs
                     where cafe_id = p_cafe_id and status = 'failed'
                       and created_at > now() - interval '12 hours'),
    'pending_jobs', (select count(*) from print_jobs
                      where cafe_id = p_cafe_id and status = 'pending'),
    'printers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'enabled', enabled,
        'last_seen_at', last_seen_at, 'last_error', last_error) order by name)
      from kot_printers where cafe_id = p_cafe_id), '[]'::jsonb)
  );
end $$;

revoke execute on function printer_health(uuid) from public, anon;
grant execute on function printer_health(uuid) to authenticated;
