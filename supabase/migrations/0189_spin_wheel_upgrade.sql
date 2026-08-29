-- ============================================================================
-- 0189 — Spin & Win upgrade: subtitle, minimum order amount, per-slice color,
-- and confetti/sound preferences.
--
-- The existing 0125/0143/0147 implementation is already sound — server-side
-- winner selection, a UNIQUE index (not just app logic) enforcing one spin
-- per order, weights never sent to the guest, transactional redemption. This
-- migration only adds the columns needed for the visual/config upgrade; it
-- does not touch any of that security architecture.
--
-- New real business rule: minimum order amount. Today ANY paid order (even
-- ₹1) earns a spin. min_order_amount = 0 keeps today's behaviour (any
-- amount qualifies) — enforced in BOTH get_spin_wheel (so the guest sees an
-- honest "why can't I spin" reason before trying) and spin_the_wheel itself
-- (never trust the client's own eligibility read), the same belt-and-braces
-- pattern payment_status is already checked in both places.
-- ============================================================================

alter table spin_wheels add column if not exists subtitle text;
alter table spin_wheels add column if not exists min_order_amount integer not null default 0 check (min_order_amount >= 0);
alter table spin_wheels add column if not exists enable_confetti boolean not null default true;
alter table spin_wheels add column if not exists enable_sound boolean not null default true;

-- Nullable: an unset slice falls back to a deterministic palette index
-- client-side (by sort position), so existing wheels render sensibly without
-- forcing every café to pick colors before this migration even runs.
alter table spin_segments add column if not exists color text;

-- ── save_spin_wheel: signature is widening (subtitle + 3 new settings
-- inserted before p_segments) — a genuinely new identity, not something
-- CREATE OR REPLACE can do in place, so the old 5-arg overload has to go
-- first (this repo's established arity-bump convention).
drop function if exists save_spin_wheel(uuid, text, boolean, integer, jsonb);

create or replace function save_spin_wheel(
  p_cafe_id           uuid,
  p_title             text,
  p_subtitle          text,
  p_active            boolean,
  p_expiry_days       integer,
  p_min_order_amount  integer,
  p_enable_confetti   boolean,
  p_enable_sound      boolean,
  p_segments          jsonb
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
  if not cafe_has_feature(p_cafe_id, 'loyalty') then
    raise exception 'the spin wheel is not available on this café''s plan';
  end if;

  insert into spin_wheels (cafe_id, title, subtitle, active, expiry_days, min_order_amount, enable_confetti, enable_sound)
  values (
    p_cafe_id, coalesce(nullif(trim(p_title), ''), 'Spin & win'), nullif(trim(p_subtitle), ''),
    coalesce(p_active, false), p_expiry_days,
    greatest(0, coalesce(p_min_order_amount, 0)), coalesce(p_enable_confetti, true), coalesce(p_enable_sound, true)
  )
  on conflict (cafe_id) do update
    set title = excluded.title, subtitle = excluded.subtitle, active = excluded.active,
        expiry_days = excluded.expiry_days, min_order_amount = excluded.min_order_amount,
        enable_confetti = excluded.enable_confetti, enable_sound = excluded.enable_sound
  returning * into v_wheel;

  delete from spin_segments where wheel_id = v_wheel.id;

  for v_seg in select * from jsonb_array_elements(coalesce(p_segments, '[]'::jsonb)) loop
    v_kind := v_seg->>'kind';
    v_item := nullif(v_seg->>'menu_item_id', '')::uuid;

    if coalesce(trim(v_seg->>'label'), '') = '' then raise exception 'every slice needs a label'; end if;
    if v_kind not in ('item', 'percent', 'flat', 'none') then raise exception 'unknown prize type "%"', v_kind; end if;

    if v_kind = 'item' then
      if v_item is null then raise exception 'pick the item for "%"', v_seg->>'label'; end if;
      if not exists (select 1 from menu_items where id = v_item and cafe_id = p_cafe_id) then
        raise exception 'that item is not on this café''s menu';
      end if;
    end if;

    insert into spin_segments (wheel_id, label, kind, menu_item_id, variant_id, value, weight, sort, color)
    values (
      v_wheel.id,
      trim(v_seg->>'label'),
      v_kind,
      v_item,
      nullif(v_seg->>'variant_id', '')::uuid,
      greatest(0, coalesce((v_seg->>'value')::integer, 0)),
      greatest(0, coalesce((v_seg->>'weight')::integer, 1)),
      v_i,
      nullif(trim(v_seg->>'color'), '')
    );
    v_total := v_total + greatest(0, coalesce((v_seg->>'weight')::integer, 1));
    v_i := v_i + 1;
  end loop;

  if v_wheel.active and v_total = 0 then
    raise exception 'give at least one slice a chance above zero before switching the wheel on';
  end if;

  return v_wheel;
end $$;

revoke execute on function save_spin_wheel(uuid, text, text, boolean, integer, integer, boolean, boolean, jsonb) from public, anon;
grant execute on function save_spin_wheel(uuid, text, text, boolean, integer, integer, boolean, boolean, jsonb) to authenticated;

-- ── get_spin_wheel: same signature, richer payload. Segments now include
-- kind + color (needed to render an icon and the right color per slice
-- before the guest spins) — this does NOT leak odds, weight is still never
-- selected. A new 'below_minimum' reason, checked in priority after the
-- existing two (already-spun and unpaid are both more specific/final than
-- an amount threshold).
create or replace function get_spin_wheel(p_receipt_token uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_order   orders%rowtype;
  v_wheel   spin_wheels%rowtype;
  v_result  spin_results%rowtype;
  v_below   boolean;
begin
  select * into v_order from orders where receipt_token = p_receipt_token;
  if not found then return jsonb_build_object('available', false); end if;

  select * into v_wheel from spin_wheels where cafe_id = v_order.cafe_id and active;
  if not found then return jsonb_build_object('available', false); end if;

  select * into v_result from spin_results where order_id = v_order.id;
  v_below := v_order.total < v_wheel.min_order_amount;

  return jsonb_build_object(
    'available', v_order.payment_status = 'paid' and v_result.id is null and not v_below,
    'title', v_wheel.title,
    'subtitle', v_wheel.subtitle,
    'min_order_amount', v_wheel.min_order_amount,
    'enable_confetti', v_wheel.enable_confetti,
    'enable_sound', v_wheel.enable_sound,
    'reason', case
      when v_result.id is not null then 'spun'
      when v_order.payment_status <> 'paid' then 'unpaid'
      when v_below then 'below_minimum'
      else null end,
    'segments', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'label', s.label, 'kind', s.kind, 'color', s.color) order by s.sort)
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

-- ── spin_the_wheel: same signature. Adds the server-side min_order_amount
-- re-check — never trust get_spin_wheel's own read of "available" as
-- authorization to actually draw, the exact same posture payment_status
-- already has here.
create or replace function spin_the_wheel(p_receipt_token uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_order         orders%rowtype;
  v_wheel         spin_wheels%rowtype;
  v_total         integer;
  v_roll          integer;
  v_seg           spin_segments%rowtype;
  v_code          text;
  v_result        spin_results%rowtype;
  v_alphabet      constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_i             integer;
  v_try           integer;
  v_feat_override boolean;
  v_plan_key      text;
  v_plan_features jsonb;
  v_has_feat      boolean;
begin
  select * into v_order from orders where receipt_token = p_receipt_token;
  if not found then raise exception 'order not found'; end if;

  select enabled into v_feat_override from cafe_feature_overrides where cafe_id = v_order.cafe_id and feature_key = 'loyalty';
  if v_feat_override is not null then
    v_has_feat := v_feat_override;
  else
    select plan into v_plan_key from cafes where id = v_order.cafe_id;
    select features into v_plan_features from platform_plans where key = v_plan_key;
    v_has_feat := coalesce((v_plan_features ->> 'loyalty')::boolean, false);
  end if;
  if not v_has_feat then
    raise exception 'this café is not running a spin wheel';
  end if;

  perform pg_advisory_xact_lock(hashtext('spin:' || v_order.id::text));

  if exists (select 1 from spin_results where order_id = v_order.id) then
    raise exception 'this order has already had its spin';
  end if;
  if v_order.payment_status <> 'paid' then
    raise exception 'the spin unlocks once the order is paid';
  end if;

  select * into v_wheel from spin_wheels where cafe_id = v_order.cafe_id and active;
  if not found then raise exception 'this café is not running a spin wheel'; end if;

  if v_order.total < v_wheel.min_order_amount then
    raise exception 'this order is below the minimum of ₹% to spin', v_wheel.min_order_amount;
  end if;

  select coalesce(sum(weight), 0) into v_total from spin_segments where wheel_id = v_wheel.id;
  if v_total <= 0 then raise exception 'this wheel has no slices to land on'; end if;

  v_roll := floor(random() * v_total)::integer;
  select s.* into v_seg from (
    select seg.*, sum(seg.weight) over (order by seg.sort, seg.id) as cum
    from spin_segments seg where seg.wheel_id = v_wheel.id
  ) s where s.cum > v_roll order by s.cum limit 1;
  if not found then raise exception 'the wheel could not settle on a slice'; end if;

  for v_try in 1..8 loop
    v_code := 'W';
    for v_i in 1..5 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::integer, 1);
    end loop;
    exit when not exists (
      select 1 from spin_results where cafe_id = v_order.cafe_id and code = v_code
    );
  end loop;

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

-- ── self-check ───────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_proc where proname = 'save_spin_wheel') <> 1 then
    raise exception 'save_spin_wheel: expected exactly one overload';
  end if;
  if (select count(*) from pg_proc where proname = 'get_spin_wheel') <> 1 then
    raise exception 'get_spin_wheel: expected exactly one overload';
  end if;
  if (select count(*) from pg_proc where proname = 'spin_the_wheel') <> 1 then
    raise exception 'spin_the_wheel: expected exactly one overload';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'spin_wheels' and column_name in ('subtitle', 'min_order_amount', 'enable_confetti', 'enable_sound')
    having count(*) = 4
  ) then
    raise exception 'spin_wheels is missing one of the new columns';
  end if;
  if not exists (
    select 1 from information_schema.columns where table_name = 'spin_segments' and column_name = 'color'
  ) then
    raise exception 'spin_segments.color was not created';
  end if;
end $$;
