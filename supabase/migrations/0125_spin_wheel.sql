-- ============================================================================
-- 0125 — Spin & win: a prize wheel a guest earns by paying for an order.
--
-- Three rules shape the whole design.
--
-- 1. The draw happens HERE, never in the browser. A wheel whose winner is
--    picked client-side is decided by whoever opens devtools. spin_the_wheel
--    is the only way to produce a result, and the segment weights are never
--    sent to a guest — only the labels needed to draw the wheel.
--
-- 2. One spin per paid order, enforced by a unique index rather than by
--    application logic, so two taps on a slow connection cannot both win.
--    The order's receipt_token is the handle: unguessable, already held by
--    the guest who placed the order, and already how they reach their bill.
--
-- 3. A result snapshots what was won. Editing the wheel afterwards must not
--    rewrite somebody's prize — the same reason order_items freezes
--    cost_snapshot and taxable_value at sale time.
-- ============================================================================

create table if not exists spin_wheels (
  id           uuid primary key default gen_random_uuid(),
  cafe_id      uuid not null unique references cafes(id) on delete cascade,
  title        text not null default 'Spin & win',
  -- Off until the owner has segments worth showing.
  active       boolean not null default false,
  -- How long a guest has to claim. Null means it never lapses.
  expiry_days  integer check (expiry_days is null or expiry_days > 0),
  created_at   timestamptz not null default now()
);

create table if not exists spin_segments (
  id           uuid primary key default gen_random_uuid(),
  wheel_id     uuid not null references spin_wheels(id) on delete cascade,
  label        text not null,
  -- 'item'    → a free menu item, the café's own dish
  -- 'percent' → n% off the next order
  -- 'flat'    → ₹n off the next order
  -- 'none'    → a losing slice; every real wheel needs some
  kind         text not null check (kind in ('item', 'percent', 'flat', 'none')),
  menu_item_id uuid references menu_items(id) on delete cascade,
  variant_id   uuid references menu_item_variants(id) on delete set null,
  value        integer not null default 0 check (value >= 0),
  -- Relative chance. The odds an owner actually types ("1 in 20") are turned
  -- into weights by the dashboard; storing the weight keeps the arithmetic in
  -- one place and makes any set of segments expressible.
  weight       integer not null default 1 check (weight >= 0),
  sort         integer not null default 0,
  constraint spin_segment_shape check (
    (kind = 'item'    and menu_item_id is not null) or
    (kind = 'percent' and value between 1 and 100 and menu_item_id is null) or
    (kind = 'flat'    and value > 0 and menu_item_id is null) or
    (kind = 'none'    and menu_item_id is null)
  )
);
create index if not exists spin_segments_wheel_idx on spin_segments (wheel_id, sort);

create table if not exists spin_results (
  id            uuid primary key default gen_random_uuid(),
  cafe_id       uuid not null references cafes(id) on delete cascade,
  segment_id    uuid references spin_segments(id) on delete set null,
  -- The order that earned the spin. One spin per order, enforced below.
  order_id      uuid not null references orders(id) on delete cascade,
  customer_id   uuid references customers(id) on delete set null,
  -- Frozen copy of the prize, so editing the wheel can't rewrite history.
  label         text not null,
  kind          text not null,
  menu_item_id  uuid references menu_items(id) on delete set null,
  variant_id    uuid references menu_item_variants(id) on delete set null,
  value         integer not null default 0,
  -- What the guest reads out at the counter.
  code          text not null,
  expires_at    timestamptz,
  redeemed_at   timestamptz,
  redeemed_order_id uuid references orders(id) on delete set null,
  created_at    timestamptz not null default now()
);
create unique index if not exists spin_results_order_key on spin_results (order_id);
create unique index if not exists spin_results_code_key on spin_results (cafe_id, code);
create index if not exists spin_results_open_idx on spin_results (cafe_id, redeemed_at);

alter table spin_wheels   enable row level security;
alter table spin_segments enable row level security;
alter table spin_results  enable row level security;

-- Members read their café's wheel; every write goes through an RPC below, so
-- no insert/update/delete policy is granted to anyone.
drop policy if exists spin_wheels_read on spin_wheels;
create policy spin_wheels_read on spin_wheels for select to authenticated
  using (exists (select 1 from cafe_members m where m.cafe_id = spin_wheels.cafe_id and m.user_id = auth.uid()));

drop policy if exists spin_segments_read on spin_segments;
create policy spin_segments_read on spin_segments for select to authenticated
  using (exists (
    select 1 from spin_wheels w join cafe_members m on m.cafe_id = w.cafe_id
    where w.id = spin_segments.wheel_id and m.user_id = auth.uid()
  ));

drop policy if exists spin_results_read on spin_results;
create policy spin_results_read on spin_results for select to authenticated
  using (exists (select 1 from cafe_members m where m.cafe_id = spin_results.cafe_id and m.user_id = auth.uid()));

revoke all on spin_wheels, spin_segments, spin_results from anon;
grant select on spin_wheels, spin_segments, spin_results to authenticated;

-- ── Owner configuration ─────────────────────────────────────────────────────
-- Replace-all, the same shape as sync_combo_slots: the payload IS the wheel,
-- which keeps "what I see is what is stored" true and avoids diffing.
create or replace function save_spin_wheel(
  p_cafe_id     uuid,
  p_title       text,
  p_active      boolean,
  p_expiry_days integer,
  p_segments    jsonb
) returns spin_wheels
language plpgsql security definer set search_path = public as $$
declare
  v_role     member_role;
  v_wheel    spin_wheels%rowtype;
  v_seg      jsonb;
  v_kind     text;
  v_item     uuid;
  v_total    integer := 0;
  v_i        integer := 0;
begin
  select role into v_role from cafe_members where cafe_id = p_cafe_id and user_id = auth.uid();
  if v_role is null then raise exception 'not authorized for this café'; end if;
  if v_role not in ('owner', 'manager') then
    raise exception 'only an owner or manager can set up the spin wheel';
  end if;

  insert into spin_wheels (cafe_id, title, active, expiry_days)
  values (p_cafe_id, coalesce(nullif(trim(p_title), ''), 'Spin & win'), coalesce(p_active, false), p_expiry_days)
  on conflict (cafe_id) do update
    set title = excluded.title, active = excluded.active, expiry_days = excluded.expiry_days
  returning * into v_wheel;

  delete from spin_segments where wheel_id = v_wheel.id;

  for v_seg in select * from jsonb_array_elements(coalesce(p_segments, '[]'::jsonb)) loop
    v_kind := v_seg->>'kind';
    v_item := nullif(v_seg->>'menu_item_id', '')::uuid;

    if coalesce(trim(v_seg->>'label'), '') = '' then raise exception 'every slice needs a label'; end if;
    if v_kind not in ('item', 'percent', 'flat', 'none') then raise exception 'unknown prize type "%"', v_kind; end if;

    -- A prize can only give away this café's own food.
    if v_kind = 'item' then
      if v_item is null then raise exception 'pick the item for "%"', v_seg->>'label'; end if;
      if not exists (select 1 from menu_items where id = v_item and cafe_id = p_cafe_id) then
        raise exception 'that item is not on this café''s menu';
      end if;
    end if;

    insert into spin_segments (wheel_id, label, kind, menu_item_id, variant_id, value, weight, sort)
    values (
      v_wheel.id,
      trim(v_seg->>'label'),
      v_kind,
      v_item,
      nullif(v_seg->>'variant_id', '')::uuid,
      greatest(0, coalesce((v_seg->>'value')::integer, 0)),
      greatest(0, coalesce((v_seg->>'weight')::integer, 1)),
      v_i
    );
    v_total := v_total + greatest(0, coalesce((v_seg->>'weight')::integer, 1));
    v_i := v_i + 1;
  end loop;

  -- A live wheel with no reachable slice would spin forever and never land.
  if v_wheel.active and v_total = 0 then
    raise exception 'give at least one slice a chance above zero before switching the wheel on';
  end if;

  return v_wheel;
end $$;

revoke execute on function save_spin_wheel(uuid, text, boolean, integer, jsonb) from public, anon;
grant execute on function save_spin_wheel(uuid, text, boolean, integer, jsonb) to authenticated;

-- ── Guest: is there a spin waiting, and what does the wheel look like? ───────
-- Labels and order only. Weights stay on the server so nobody can read the
-- odds off the wire, or work out which slice to aim for.
create or replace function get_spin_wheel(p_receipt_token uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_order   orders%rowtype;
  v_wheel   spin_wheels%rowtype;
  v_result  spin_results%rowtype;
begin
  select * into v_order from orders where receipt_token = p_receipt_token;
  if not found then return jsonb_build_object('available', false); end if;

  select * into v_wheel from spin_wheels where cafe_id = v_order.cafe_id and active;
  if not found then return jsonb_build_object('available', false); end if;

  select * into v_result from spin_results where order_id = v_order.id;

  return jsonb_build_object(
    'available', v_order.payment_status = 'paid' and v_result.id is null,
    'title', v_wheel.title,
    'reason', case
      when v_result.id is not null then 'spun'
      when v_order.payment_status <> 'paid' then 'unpaid'
      else null end,
    'segments', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'label', s.label) order by s.sort)
      from spin_segments s where s.wheel_id = v_wheel.id
    ), '[]'::jsonb),
    'result', case when v_result.id is null then null else jsonb_build_object(
      'segment_id', v_result.segment_id, 'label', v_result.label, 'kind', v_result.kind,
      'value', v_result.value, 'code', v_result.code,
      'expires_at', v_result.expires_at, 'redeemed', v_result.redeemed_at is not null
    ) end
  );
end $$;

revoke execute on function get_spin_wheel(uuid) from public;
grant execute on function get_spin_wheel(uuid) to anon, authenticated;

-- ── The draw ────────────────────────────────────────────────────────────────
create or replace function spin_the_wheel(p_receipt_token uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order   orders%rowtype;
  v_wheel   spin_wheels%rowtype;
  v_total   integer;
  v_roll    integer;
  v_seg     spin_segments%rowtype;
  v_code    text;
  v_result  spin_results%rowtype;
begin
  select * into v_order from orders where receipt_token = p_receipt_token;
  if not found then raise exception 'order not found'; end if;

  -- Serialise per order, so a double tap can't produce two draws before the
  -- unique index is reached.
  perform pg_advisory_xact_lock(hashtext('spin:' || v_order.id::text));

  if exists (select 1 from spin_results where order_id = v_order.id) then
    raise exception 'this order has already had its spin';
  end if;
  if v_order.payment_status <> 'paid' then
    raise exception 'the spin unlocks once the order is paid';
  end if;

  select * into v_wheel from spin_wheels where cafe_id = v_order.cafe_id and active;
  if not found then raise exception 'this café is not running a spin wheel'; end if;

  select coalesce(sum(weight), 0) into v_total from spin_segments where wheel_id = v_wheel.id;
  if v_total <= 0 then raise exception 'this wheel has no slices to land on'; end if;

  -- Weighted draw: roll once into the total, then take the first slice whose
  -- running total passes it.
  v_roll := floor(random() * v_total)::integer;
  select s.* into v_seg from (
    select seg.*, sum(seg.weight) over (order by seg.sort, seg.id) as cum
    from spin_segments seg where seg.wheel_id = v_wheel.id
  ) s where s.cum > v_roll order by s.cum limit 1;
  if not found then raise exception 'the wheel could not settle on a slice'; end if;

  -- Short, unambiguous at a noisy counter: no O/0 or I/1.
  v_code := 'W' || upper(substr(translate(encode(gen_random_bytes(8), 'base64'), 'OoIl01/+=', 'XYZKMN'), 1, 5));

  insert into spin_results (
    cafe_id, segment_id, order_id, customer_id,
    label, kind, menu_item_id, variant_id, value, code, expires_at
  ) values (
    v_order.cafe_id, v_seg.id, v_order.id, v_order.customer_id,
    v_seg.label, v_seg.kind, v_seg.menu_item_id, v_seg.variant_id, v_seg.value, v_code,
    case when v_wheel.expiry_days is null then null else now() + (v_wheel.expiry_days || ' days')::interval end
  ) returning * into v_result;

  return jsonb_build_object(
    'segment_id', v_result.segment_id, 'label', v_result.label, 'kind', v_result.kind,
    'value', v_result.value, 'code', v_result.code, 'expires_at', v_result.expires_at
  );
end $$;

revoke execute on function spin_the_wheel(uuid) from public;
grant execute on function spin_the_wheel(uuid) to anon, authenticated;

-- ── Counter: look a prize up, and claim it ──────────────────────────────────
create or replace function find_spin_prize(p_cafe_id uuid, p_code text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_r spin_results%rowtype;
begin
  if not exists (select 1 from cafe_members where cafe_id = p_cafe_id and user_id = auth.uid()) then
    raise exception 'not authorized for this café';
  end if;

  select * into v_r from spin_results
   where cafe_id = p_cafe_id and upper(code) = upper(trim(p_code));
  if not found then raise exception 'no prize with that code'; end if;

  return jsonb_build_object(
    'id', v_r.id, 'label', v_r.label, 'kind', v_r.kind, 'value', v_r.value,
    'menu_item_id', v_r.menu_item_id, 'variant_id', v_r.variant_id,
    'redeemed', v_r.redeemed_at is not null,
    'expired', v_r.expires_at is not null and v_r.expires_at < now()
  );
end $$;

revoke execute on function find_spin_prize(uuid, text) from public, anon;
grant execute on function find_spin_prize(uuid, text) to authenticated;

-- Claiming is a state change, so it takes its own lock and re-checks rather
-- than trusting whatever find_spin_prize told the till a moment ago.
create or replace function redeem_spin_prize(p_cafe_id uuid, p_code text, p_order_id uuid default null)
returns spin_results
language plpgsql security definer set search_path = public as $$
declare v_r spin_results%rowtype;
begin
  if not exists (select 1 from cafe_members where cafe_id = p_cafe_id and user_id = auth.uid()) then
    raise exception 'not authorized for this café';
  end if;

  perform pg_advisory_xact_lock(hashtext('spinclaim:' || p_cafe_id::text || ':' || upper(trim(p_code))));

  select * into v_r from spin_results
   where cafe_id = p_cafe_id and upper(code) = upper(trim(p_code)) for update;
  if not found then raise exception 'no prize with that code'; end if;
  if v_r.redeemed_at is not null then raise exception 'that prize has already been claimed'; end if;
  if v_r.expires_at is not null and v_r.expires_at < now() then raise exception 'that prize has expired'; end if;
  if v_r.kind = 'none' then raise exception 'that spin did not win anything'; end if;

  update spin_results
     set redeemed_at = now(), redeemed_order_id = p_order_id
   where id = v_r.id
  returning * into v_r;

  return v_r;
end $$;

revoke execute on function redeem_spin_prize(uuid, text, uuid) from public, anon;
grant execute on function redeem_spin_prize(uuid, text, uuid) to authenticated;
