-- ============================================================================
-- 0019 — Platform Operator Panel: extends the EXISTING /platform-admin
-- foundation (platform_admins, is_platform_admin(), platform_audit_logs from
-- supabase/platform-admin.sql) rather than building a second, parallel admin
-- system. Every operator mutation below is gated by is_platform_admin() and
-- writes a before/after row to platform_audit_logs — the same append-only,
-- unwritable-by-anyone-else table that already exists.
--
-- Explicit non-goals this pass (each needs café-owner-side UI too, which is a
-- separate slice of work from the operator panel itself — not built here):
--   * Support tickets (café owners need a submission form on their side)
--   * Platform announcements (café app needs a banner/inbox to show them)
--   * "View as café" impersonation — the safe way to do this is Supabase's
--     admin API (auth.admin.generateLink), which needs SUPABASE_SERVICE_ROLE_KEY.
--     That key is commented out/unset in .env.local right now. Per the explicit
--     instruction ("if the architecture cannot support this safely, do not
--     implement it yet"), this is deferred until that key is provisioned.
-- ============================================================================

-- ── 1. Café account state: verification + status, separate concerns ────────
-- `plan` (existing column) is the commercial tier. `status` is the operational
-- account state — a café can be on the trial plan and status='active' at the
-- same time (using the product, not yet paying). Suspending/disabling is a
-- status change, never a plan change.
alter table cafes add column if not exists verified boolean not null default false;
alter table cafes add column if not exists verified_by uuid references auth.users(id) on delete set null;
alter table cafes add column if not exists verified_at timestamptz;
alter table cafes add column if not exists status text not null default 'active';
alter table cafes add column if not exists status_reason text;
alter table cafes add column if not exists status_changed_at timestamptz;
alter table cafes add column if not exists status_changed_by uuid references auth.users(id) on delete set null;
alter table cafes add column if not exists trial_ends_at timestamptz;
alter table cafes add column if not exists subscription_ends_at timestamptz;

do $$ begin
  alter table cafes add constraint cafes_status_chk check (status in ('active', 'suspended', 'disabled', 'archived'));
exception when duplicate_object then null; end $$;

-- ── 2. Make suspension actually stop operations, everywhere, in one place ──
-- is_cafe_member() already gates every "member all" RLS policy (customers,
-- orders, payments, loyalty, coupons, inventory, expenses, cafe_settings,
-- table_sessions, notifications, held_orders) AND every staff-facing RPC
-- (staff_place_order, cancel_order, move_session, close_session, ...). Adding
-- the café's own active/suspended state to this ONE function makes "Suspend
-- café" effective across the entire app immediately, with no per-screen work.
--
-- But cafes/cafe_members "member read" ALSO used is_cafe_member — if left
-- unchanged, a suspended owner would see zero memberships and get bounced to
-- /onboarding, looking like their account vanished instead of "you're
-- suspended, contact support." So visibility uses a separate, status-
-- independent check; only WRITE-capable/operational access is status-gated.
create or replace function is_cafe_member_any_status(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from cafe_members
    where cafe_id = target and user_id = auth.uid() and status = 'active'
  );
$$;
revoke execute on function is_cafe_member_any_status(uuid) from public, anon;
grant execute on function is_cafe_member_any_status(uuid) to authenticated;

create or replace function is_cafe_member(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from cafe_members cm
    join cafes c on c.id = cm.cafe_id
    where cm.cafe_id = target and cm.user_id = auth.uid() and cm.status = 'active'
      and c.status = 'active'
  );
$$;

drop policy if exists "member read" on cafes;
create policy "member read" on cafes for select using (is_cafe_member_any_status(id));

drop policy if exists "member read" on cafe_members;
create policy "member read" on cafe_members for select using (is_cafe_member_any_status(cafe_id));

-- Anonymous QR ordering never goes through is_cafe_member (no staff session
-- exists), so a suspended café's own customers could otherwise keep ordering
-- straight through the outage. Gate the 3 anon-callable entry points directly.
create or replace function place_order(
  p_token          text,
  p_items          jsonb,
  p_phone          text default null,
  p_payment_method text default 'counter',
  p_upsell_item_id uuid default null,
  p_upsell_shown   boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id      uuid;
  v_cafe_status  text;
  v_table_id     uuid;
  v_session_id   uuid;
  v_order_id     uuid;
  v_customer_id  uuid;
  v_phone        text;
  v_receipt      uuid;
  v_subtotal     integer := 0;
  v_seq          integer;
  v_day_start    timestamptz;
  v_item         jsonb;
  v_qty          integer;
  v_id           uuid;
  v_name         text;
  v_price        integer;
  v_unit         integer;
  v_mods         jsonb;
  v_has_variants boolean;
  v_variant_id   uuid;
  v_vname        text;
  v_vdelta       integer;
  v_addon        text;
  v_aname        text;
  v_aprice       integer;
  v_upsell_taken boolean := false;
  v_upsell_value integer := 0;
  v_base         integer;
  v_tax          integer;
  v_svc          integer;
  v_total        integer;
begin
  if p_payment_method not in ('counter','cash','card') then
    raise exception 'invalid payment method';
  end if;

  v_phone := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
  if v_phone is not null and v_phone !~ '^[6-9][0-9]{9}$' then
    raise exception 'invalid phone number';
  end if;

  select id, cafe_id into v_table_id, v_cafe_id from cafe_tables where token = p_token;
  if v_cafe_id is null then raise exception 'invalid table'; end if;

  select status into v_cafe_status from cafes where id = v_cafe_id;
  if v_cafe_status <> 'active' then raise exception 'this café is not currently accepting orders'; end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'empty order';
  end if;

  v_session_id := get_or_create_session(v_cafe_id, v_table_id);

  if v_phone is not null then
    insert into customers (cafe_id, phone, last_seen)
    values (v_cafe_id, v_phone, now())
    on conflict (cafe_id, phone) do update set last_seen = now()
    returning id into v_customer_id;
  end if;

  v_day_start := (date_trunc('day', (now() at time zone 'Asia/Kolkata')) at time zone 'Asia/Kolkata');
  select count(*) + 1 into v_seq from orders
    where cafe_id = v_cafe_id and status <> 'cancelled' and created_at >= v_day_start;

  insert into orders (cafe_id, table_id, session_id, customer_id, short_code, type, status, payment_status,
                      phone, payment_method, subtotal, total, upsell_shown, source)
    values (v_cafe_id, v_table_id, v_session_id, v_customer_id, v_seq::text, 'dine_in', 'placed', 'unpaid',
            v_phone, p_payment_method::payment_method, 0, 0, coalesce(p_upsell_shown, false), 'qr')
    returning id, receipt_token into v_order_id, v_receipt;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(1, coalesce((v_item->>'qty')::int, 1));

    select id, name, price into v_id, v_name, v_price
      from menu_items
      where id = (v_item->>'item_id')::uuid
        and cafe_id = v_cafe_id and available = true and archived = false;
    if v_id is null then raise exception 'item not available'; end if;

    v_unit := v_price;
    v_mods := '[]'::jsonb;

    v_has_variants := exists (select 1 from menu_item_variants where menu_item_id = v_id);
    v_variant_id := nullif(v_item->>'variant_id','')::uuid;
    if v_has_variants and v_variant_id is null then
      raise exception 'variant required';
    end if;
    if v_variant_id is not null then
      select name, price_delta into v_vname, v_vdelta
        from menu_item_variants where id = v_variant_id and menu_item_id = v_id;
      if v_vname is null then raise exception 'invalid variant'; end if;
      v_unit := v_unit + v_vdelta;
      v_mods := v_mods || jsonb_build_object('name', v_vname, 'price', v_vdelta);
      v_name := v_name || ' (' || v_vname || ')';
    end if;

    if v_item ? 'addon_ids' then
      for v_addon in select jsonb_array_elements_text(v_item->'addon_ids') loop
        select name, price into v_aname, v_aprice
          from menu_item_addons where id = v_addon::uuid and menu_item_id = v_id;
        if v_aname is null then raise exception 'invalid add-on'; end if;
        v_unit := v_unit + v_aprice;
        v_mods := v_mods || jsonb_build_object('name', v_aname, 'price', v_aprice);
      end loop;
    end if;

    insert into order_items (order_id, menu_item_id, name, price, qty, modifiers)
      values (v_order_id, v_id, v_name, v_unit, v_qty, v_mods);
    v_subtotal := v_subtotal + v_unit * v_qty;

    if p_upsell_item_id is not null and v_id = p_upsell_item_id then
      v_upsell_taken := true;
      v_upsell_value := v_unit * v_qty;
    end if;
  end loop;

  select * into v_base, v_tax, v_svc, v_total from compute_bill(v_cafe_id, v_subtotal, 0);

  update orders
    set subtotal = v_subtotal, tax = v_tax, service_charge = v_svc, total = v_total,
        upsell_item_id = p_upsell_item_id, upsell_taken = v_upsell_taken, upsell_value = v_upsell_value
    where id = v_order_id;

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (v_cafe_id, null, 'order.created', 'orders', v_order_id,
          jsonb_build_object('source', 'qr', 'total', v_total, 'table_id', v_table_id));

  insert into notifications (cafe_id, type, message, table_id, session_id)
  select v_cafe_id, 'new_order', 'Table ' || t.label || ' placed a new order — #' || v_seq, v_table_id, v_session_id
  from cafe_tables t where t.id = v_table_id;

  return jsonb_build_object('short_code', v_seq::text, 'total', v_total, 'receipt_token', v_receipt);
end $$;

grant execute on function place_order(text, jsonb, text, text, uuid, boolean) to anon, authenticated;

create or replace function request_bill(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cafe uuid; v_status text; v_table uuid; v_label text; v_session uuid; v_recent boolean;
begin
  select t.cafe_id, t.id, t.label into v_cafe, v_table, v_label from cafe_tables t where t.token = p_token;
  if v_cafe is null then raise exception 'invalid table'; end if;
  select status into v_status from cafes where id = v_cafe;
  if v_status <> 'active' then raise exception 'this café is not currently active'; end if;

  select id into v_session from table_sessions
    where cafe_id = v_cafe and table_id = v_table and status in ('active','bill_requested')
    order by started_at desc limit 1;
  if v_session is null then raise exception 'no active session for this table'; end if;

  select exists (
    select 1 from notifications
    where table_id = v_table and type = 'bill_requested' and created_at > now() - interval '2 minutes'
  ) into v_recent;
  if v_recent then return jsonb_build_object('ok', true, 'throttled', true); end if;

  update table_sessions set status = 'bill_requested' where id = v_session;
  insert into notifications (cafe_id, type, message, table_id, session_id)
  values (v_cafe, 'bill_requested', 'Table ' || v_label || ' requested the bill.', v_table, v_session);

  return jsonb_build_object('ok', true, 'throttled', false);
end $$;

create or replace function call_waiter(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cafe uuid; v_status text; v_table uuid; v_label text; v_session uuid; v_recent boolean;
begin
  select t.cafe_id, t.id, t.label into v_cafe, v_table, v_label from cafe_tables t where t.token = p_token;
  if v_cafe is null then raise exception 'invalid table'; end if;
  select status into v_status from cafes where id = v_cafe;
  if v_status <> 'active' then raise exception 'this café is not currently active'; end if;

  select id into v_session from table_sessions
    where cafe_id = v_cafe and table_id = v_table and status in ('active','bill_requested')
    order by started_at desc limit 1;

  select exists (
    select 1 from notifications
    where table_id = v_table and type = 'call_waiter' and created_at > now() - interval '2 minutes'
  ) into v_recent;
  if v_recent then return jsonb_build_object('ok', true, 'throttled', true); end if;

  insert into notifications (cafe_id, type, message, table_id, session_id)
  values (v_cafe, 'call_waiter', 'Table ' || v_label || ' requires assistance.', v_table, v_session);

  return jsonb_build_object('ok', true, 'throttled', false);
end $$;

grant execute on function request_bill(text) to anon, authenticated;
grant execute on function call_waiter(text) to anon, authenticated;

-- ── 3. Dynamic plans (not hardcoded plan names scattered through the app) ──
create table if not exists platform_plans (
  id            uuid primary key default gen_random_uuid(),
  key           text not null unique,
  name          text not null,
  price_monthly integer not null default 0,
  features      jsonb not null default '{}',
  sort          integer not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
alter table platform_plans enable row level security;
create policy "admin all" on platform_plans for all using (is_platform_admin()) with check (is_platform_admin());
create policy "authenticated read" on platform_plans for select to authenticated using (true);

insert into platform_plans (key, name, price_monthly, features, sort) values
  ('trial', 'Trial', 0,
   '{"qr_ordering":true,"kds":true,"crm":false,"inventory":false,"reservations":false,"advanced_analytics":false,"sms_bills":false,"multi_staff":false,"advanced_reports":false}', 0),
  ('starter', 'Starter', 999,
   '{"qr_ordering":true,"kds":true,"crm":true,"inventory":false,"reservations":false,"advanced_analytics":false,"sms_bills":true,"multi_staff":true,"advanced_reports":false}', 1),
  ('pro', 'Pro', 2499,
   '{"qr_ordering":true,"kds":true,"crm":true,"inventory":true,"reservations":true,"advanced_analytics":true,"sms_bills":true,"multi_staff":true,"advanced_reports":true}', 2),
  ('business', 'Business', 4999,
   '{"qr_ordering":true,"kds":true,"crm":true,"inventory":true,"reservations":true,"advanced_analytics":true,"sms_bills":true,"multi_staff":true,"advanced_reports":true}', 3)
on conflict (key) do nothing;

-- ── 4. Centralized feature entitlements — one function, not scattered
--    frontend `if (plan === 'pro')` checks. Override (if set) beats the
--    café's plan default. ───────────────────────────────────────────────────
create table if not exists cafe_feature_overrides (
  id          uuid primary key default gen_random_uuid(),
  cafe_id     uuid not null references cafes(id) on delete cascade,
  feature_key text not null,
  enabled     boolean not null,
  set_by      uuid references auth.users(id) on delete set null,
  set_at      timestamptz not null default now(),
  unique (cafe_id, feature_key)
);
alter table cafe_feature_overrides enable row level security;
create policy "admin all" on cafe_feature_overrides for all using (is_platform_admin()) with check (is_platform_admin());
create policy "member read" on cafe_feature_overrides for select using (is_cafe_member_any_status(cafe_id));

create or replace function cafe_has_feature(p_cafe_id uuid, p_feature text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_override boolean;
  v_plan_key text;
  v_plan_features jsonb;
begin
  -- Fail closed for anyone who isn't a member of THIS café (or an operator) —
  -- otherwise any authenticated user could probe another café's entitlements
  -- by cafe_id, a real cross-tenant leak even though the payload is "just" a
  -- boolean flag, not customer data.
  if not (is_cafe_member(p_cafe_id) or is_platform_admin()) then
    return false;
  end if;

  select enabled into v_override from cafe_feature_overrides where cafe_id = p_cafe_id and feature_key = p_feature;
  if v_override is not null then return v_override; end if;

  select plan into v_plan_key from cafes where id = p_cafe_id;
  select features into v_plan_features from platform_plans where key = v_plan_key;
  if v_plan_features is null then return false; end if;
  return coalesce((v_plan_features ->> p_feature)::boolean, false);
end $$;

revoke execute on function cafe_has_feature(uuid, text) from public, anon;
grant execute on function cafe_has_feature(uuid, text) to authenticated;

-- ── 5. Operator notes — never café-visible (no café-facing policy at all) ──
create table if not exists operator_notes (
  id         uuid primary key default gen_random_uuid(),
  cafe_id    uuid not null references cafes(id) on delete cascade,
  note       text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table operator_notes enable row level security;
create policy "admin all" on operator_notes for all using (is_platform_admin()) with check (is_platform_admin());

-- ── 6. Password reset log — the reset itself uses Supabase Auth's existing
--    resetPasswordForEmail() (magic-link flow); this table only records that
--    an operator initiated one. No password, temp or otherwise, is ever
--    stored here or anywhere. ────────────────────────────────────────────────
create table if not exists password_reset_log (
  id             uuid primary key default gen_random_uuid(),
  cafe_id        uuid references cafes(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  target_email   text not null,
  initiated_by   uuid references auth.users(id) on delete set null,
  status         text not null default 'sent',
  error          text,
  created_at     timestamptz not null default now()
);
alter table password_reset_log enable row level security;
create policy "admin read" on password_reset_log for select using (is_platform_admin());
create policy "admin insert" on password_reset_log for insert with check (is_platform_admin());

-- ── 7. Onboarding progress — pure computation over existing data, no schema
--    needed beyond what already exists (menu_items, cafe_tables, cafe_members,
--    orders). security_invoker so it's safe to query directly. ─────────────
create or replace view v_cafe_onboarding
with (security_invoker = true) as
select
  c.id as cafe_id,
  true as account_created,
  (c.phone is not null and c.address is not null) as profile_completed,
  exists (select 1 from menu_items mi where mi.cafe_id = c.id) as menu_added,
  exists (select 1 from cafe_tables ct where ct.cafe_id = c.id) as tables_created,
  exists (select 1 from cafe_tables ct where ct.cafe_id = c.id and ct.token is not null) as qr_generated,
  (select count(*) from cafe_members cm where cm.cafe_id = c.id and cm.status = 'active') > 1 as staff_added,
  exists (select 1 from orders o where o.cafe_id = c.id and o.status <> 'cancelled') as first_order_placed
from cafes c;

-- ── 8. Operator mutations — every one gated by is_platform_admin(), every one
--    writes a before/after row to platform_audit_logs. ─────────────────────
create or replace function op_verify_cafe(p_cafe_id uuid, p_verified boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_before jsonb;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select jsonb_build_object('verified', verified) into v_before from cafes where id = p_cafe_id;
  if v_before is null then raise exception 'cafe not found'; end if;

  update cafes set
    verified = p_verified,
    verified_by = case when p_verified then auth.uid() else null end,
    verified_at = case when p_verified then now() else null end
  where id = p_cafe_id;

  insert into platform_audit_logs (actor_id, action, target_type, target_id, previous_value, new_value)
  values (auth.uid(), case when p_verified then 'cafe.verified' else 'cafe.unverified' end,
          'cafe', p_cafe_id, v_before, jsonb_build_object('verified', p_verified));
end $$;

create or replace function op_set_cafe_status(p_cafe_id uuid, p_status text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_before text;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if p_status not in ('active', 'suspended', 'disabled', 'archived') then raise exception 'invalid status'; end if;
  if p_reason is null or trim(p_reason) = '' then raise exception 'a reason is required'; end if;

  select status into v_before from cafes where id = p_cafe_id;
  if v_before is null then raise exception 'cafe not found'; end if;

  update cafes set status = p_status, status_reason = trim(p_reason),
                  status_changed_at = now(), status_changed_by = auth.uid()
  where id = p_cafe_id;

  insert into platform_audit_logs (actor_id, action, target_type, target_id, previous_value, new_value)
  values (auth.uid(), 'cafe.status_changed', 'cafe', p_cafe_id,
          jsonb_build_object('status', v_before),
          jsonb_build_object('status', p_status, 'reason', trim(p_reason)));
end $$;

create or replace function op_change_plan(p_cafe_id uuid, p_plan_key text)
returns void language plpgsql security definer set search_path = public as $$
declare v_before text; v_exists boolean;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select exists(select 1 from platform_plans where key = p_plan_key and active) into v_exists;
  if not v_exists then raise exception 'unknown or inactive plan: %', p_plan_key; end if;

  select plan into v_before from cafes where id = p_cafe_id;
  if v_before is null then raise exception 'cafe not found'; end if;

  update cafes set plan = p_plan_key where id = p_cafe_id;

  insert into platform_audit_logs (actor_id, action, target_type, target_id, previous_value, new_value)
  values (auth.uid(), 'cafe.plan_changed', 'cafe', p_cafe_id,
          jsonb_build_object('plan', v_before), jsonb_build_object('plan', p_plan_key));
end $$;

create or replace function op_extend_subscription(
  p_cafe_id uuid, p_subscription_ends_at timestamptz, p_trial_ends_at timestamptz default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_before jsonb;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select jsonb_build_object('subscription_ends_at', subscription_ends_at, 'trial_ends_at', trial_ends_at)
    into v_before from cafes where id = p_cafe_id;
  if v_before is null then raise exception 'cafe not found'; end if;

  update cafes set subscription_ends_at = p_subscription_ends_at,
                  trial_ends_at = coalesce(p_trial_ends_at, trial_ends_at)
  where id = p_cafe_id;

  insert into platform_audit_logs (actor_id, action, target_type, target_id, previous_value, new_value)
  values (auth.uid(), 'cafe.subscription_extended', 'cafe', p_cafe_id, v_before,
          jsonb_build_object('subscription_ends_at', p_subscription_ends_at));
end $$;

create or replace function op_set_feature_override(p_cafe_id uuid, p_feature_key text, p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_before boolean;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select enabled into v_before from cafe_feature_overrides where cafe_id = p_cafe_id and feature_key = p_feature_key;

  insert into cafe_feature_overrides (cafe_id, feature_key, enabled, set_by)
  values (p_cafe_id, p_feature_key, p_enabled, auth.uid())
  on conflict (cafe_id, feature_key) do update set enabled = p_enabled, set_by = auth.uid(), set_at = now();

  insert into platform_audit_logs (actor_id, action, target_type, target_id, previous_value, new_value)
  values (auth.uid(), 'cafe.feature_override_changed', 'cafe', p_cafe_id,
          jsonb_build_object('feature', p_feature_key, 'enabled', v_before),
          jsonb_build_object('feature', p_feature_key, 'enabled', p_enabled));
end $$;

create or replace function op_clear_feature_override(p_cafe_id uuid, p_feature_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  delete from cafe_feature_overrides where cafe_id = p_cafe_id and feature_key = p_feature_key;
  insert into platform_audit_logs (actor_id, action, target_type, target_id, new_value)
  values (auth.uid(), 'cafe.feature_override_cleared', 'cafe', p_cafe_id, jsonb_build_object('feature', p_feature_key));
end $$;

create or replace function op_add_operator_note(p_cafe_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if p_note is null or trim(p_note) = '' then raise exception 'note cannot be empty'; end if;
  insert into operator_notes (cafe_id, note, created_by) values (p_cafe_id, trim(p_note), auth.uid());
  insert into platform_audit_logs (actor_id, action, target_type, target_id, new_value)
  values (auth.uid(), 'cafe.note_added', 'cafe', p_cafe_id, jsonb_build_object('note', trim(p_note)));
end $$;

revoke execute on function op_verify_cafe(uuid, boolean) from public, anon;
revoke execute on function op_set_cafe_status(uuid, text, text) from public, anon;
revoke execute on function op_change_plan(uuid, text) from public, anon;
revoke execute on function op_extend_subscription(uuid, timestamptz, timestamptz) from public, anon;
revoke execute on function op_set_feature_override(uuid, text, boolean) from public, anon;
revoke execute on function op_clear_feature_override(uuid, text) from public, anon;
revoke execute on function op_add_operator_note(uuid, text) from public, anon;

grant execute on function op_verify_cafe(uuid, boolean) to authenticated;
grant execute on function op_set_cafe_status(uuid, text, text) to authenticated;
grant execute on function op_change_plan(uuid, text) to authenticated;
grant execute on function op_extend_subscription(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function op_set_feature_override(uuid, text, boolean) to authenticated;
grant execute on function op_clear_feature_override(uuid, text) to authenticated;
grant execute on function op_add_operator_note(uuid, text) to authenticated;
