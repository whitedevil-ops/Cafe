-- ============================================================================
-- 0143 — HIGH: coupons, loyalty rewards and the spin wheel were plan-gated
--        only in the UI (nav hidden, page redirects via hasFeature()) — the
--        RPCs that actually create and redeem them never checked
--        cafe_has_feature() at all. A Starter café's own staff could call
--        create_coupon/create_reward/save_spin_wheel/resolve_coupon_discount/
--        redeem_reward/redeem_spin_prize directly via supabase.rpc() and use
--        every one of these plan-gated features for free, same as the
--        pattern this session already corrected once before in commit
--        b420f4e ("the server recomputes every rupee regardless of what the
--        client sends" — which turned out to be false for exactly this
--        reason).
--
-- 0073 added the 'coupons'/'loyalty' keys to platform_plans.features and
-- enforced ONLY the staff-seat cap; it never touched the coupon/reward/spin
-- RPCs. This migration closes that gap using the existing canonical checker
-- (cafe_has_feature(), 0019) — not a new/duplicated implementation.
--
-- Two shapes, depending on who calls each function:
--   * Staff-only functions (caller is always an authenticated café member)
--     call cafe_has_feature(p_cafe_id, key) directly — it already fails
--     closed for non-members via is_cafe_member()/is_platform_admin().
--   * Functions reachable by an ANONYMOUS customer (resolve_coupon_discount
--     via place_order, spin_the_wheel via receipt token) cannot call
--     cafe_has_feature() directly — it always returns false for anon, since
--     anon has no auth.uid() to check membership with (this exact trap bit
--     wallet_start_topup once already, fixed in 0092). These inline the same
--     override-then-plan-default precedence cafe_has_feature() itself uses,
--     which is safe here because the caller's tenant/order identity was
--     already established before reaching this point (place_order's table
--     token, or the order the receipt_token names) — 0092's precedent
--     exactly.
--
-- Gated:
--   resolve_coupon_discount — the single choke point both order engines and
--     both coupon-preview RPCs (validate_coupon, validate_coupon_public)
--     route through, so gating it here covers all four uniformly.
--   create_coupon — a café shouldn't be able to build a coupon catalog it
--     can never legitimately use.
--   create_reward, redeem_reward — reward creation and the standalone
--     (no-menu-item) redemption path.
--   staff_place_order — the ONE line needed for the OTHER reward-redemption
--     path (a reward linked to a real menu item, redeemed inline as part of
--     placing the order, 0120). Everything else in this function is
--     byte-for-byte identical to its current live body (0126) — this is the
--     same "copy verbatim, change one intentional line" discipline already
--     used for its last several redefinitions.
--   save_spin_wheel — can't configure/activate a wheel without the plan.
--   spin_the_wheel, redeem_spin_prize — the actual prize-drawing and
--     prize-claiming actions, so a café that had loyalty on a higher plan,
--     configured a wheel, then downgraded can't keep giving away real
--     inventory through an already-active wheel row.
--
-- Not gated (deliberately): set_coupon_active, set_coupon_categories,
-- coupon_stats, list_applicable_coupons, validate_coupon, validate_coupon_
-- public, set_reward_active, delete_reward, get_spin_wheel, find_spin_prize.
-- These are pure management/preview/read actions on data that may already
-- exist from before a downgrade — an owner must still be able to see and
-- deactivate what they already have. list_applicable_coupons/validate_*
-- specifically preview a discount but never grant one on their own; the
-- actual grant happens inside resolve_coupon_discount, which IS gated, so a
-- disabled café's preview will correctly fail the same way redemption does.
-- ============================================================================

-- ── Coupons: single redemption choke point (covers place_order,
--     staff_place_order, validate_coupon, validate_coupon_public alike) ─────
create or replace function resolve_coupon_discount(
  p_cafe_id      uuid,
  p_code         text,
  p_subtotal     integer,
  p_customer_id  uuid default null,
  p_category_ids uuid[] default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_coupon        coupons%rowtype;
  v_used          integer;
  v_by_cust       integer;
  v_disc          integer;
  v_restricted    uuid[];
  v_cat_names     text;
  v_feat_override boolean;
  v_plan_key      text;
  v_plan_features jsonb;
  v_has_feat      boolean;
begin
  if p_code is null or trim(p_code) = '' then
    raise exception 'enter a coupon code';
  end if;

  select enabled into v_feat_override from cafe_feature_overrides where cafe_id = p_cafe_id and feature_key = 'coupons';
  if v_feat_override is not null then
    v_has_feat := v_feat_override;
  else
    select plan into v_plan_key from cafes where id = p_cafe_id;
    select features into v_plan_features from platform_plans where key = v_plan_key;
    v_has_feat := coalesce((v_plan_features ->> 'coupons')::boolean, false);
  end if;
  if not v_has_feat then
    raise exception 'coupons are not available on this café''s plan';
  end if;

  select * into v_coupon from coupons
    where cafe_id = p_cafe_id and upper(code) = upper(trim(p_code));
  if v_coupon.id is null then
    raise exception 'coupon "%" was not found', trim(p_code);
  end if;

  if not v_coupon.active then
    raise exception 'coupon "%" is no longer active', v_coupon.code;
  end if;
  if v_coupon.starts_at is not null and now() < v_coupon.starts_at then
    raise exception 'coupon "%" is not active yet', v_coupon.code;
  end if;
  if v_coupon.ends_at is not null and now() > v_coupon.ends_at then
    raise exception 'coupon "%" has expired', v_coupon.code;
  end if;
  if v_coupon.kind not in ('percent', 'flat') then
    raise exception 'coupon "%" needs to be applied manually by staff', v_coupon.code;
  end if;
  if p_subtotal < v_coupon.min_order then
    raise exception 'coupon "%" needs a minimum order of ₹%', v_coupon.code, v_coupon.min_order;
  end if;

  select coalesce(array_agg(category_id), array[]::uuid[]) into v_restricted
    from coupon_categories where coupon_id = v_coupon.id;
  if array_length(v_restricted, 1) > 0
     and not (v_restricted && coalesce(p_category_ids, array[]::uuid[])) then
    select string_agg(name, ', ' order by name) into v_cat_names
      from menu_categories where id = any(v_restricted);
    raise exception 'coupon "%" only applies to an order containing: %', v_coupon.code, coalesce(v_cat_names, 'specific items');
  end if;

  if v_coupon.usage_limit is not null then
    select count(*) into v_used from coupon_redemptions where coupon_id = v_coupon.id;
    if v_used >= v_coupon.usage_limit then
      raise exception 'coupon "%" has reached its usage limit', v_coupon.code;
    end if;
  end if;

  if v_coupon.per_customer is not null and p_customer_id is not null then
    select count(*) into v_by_cust
      from coupon_redemptions where coupon_id = v_coupon.id and customer_id = p_customer_id;
    if v_by_cust >= v_coupon.per_customer then
      raise exception 'coupon "%" has already been used the maximum number of times on this number', v_coupon.code;
    end if;
  end if;

  if v_coupon.kind = 'percent' then
    v_disc := round(p_subtotal * least(greatest(v_coupon.value, 0), 100) / 100.0);
    if v_coupon.max_discount is not null then
      v_disc := least(v_disc, v_coupon.max_discount);
    end if;
  else
    v_disc := v_coupon.value;
  end if;
  v_disc := greatest(0, least(v_disc, p_subtotal));

  return jsonb_build_object(
    'coupon_id', v_coupon.id, 'code', v_coupon.code, 'name', v_coupon.name,
    'kind', v_coupon.kind, 'discount', v_disc);
end $$;
-- Grants unchanged (0138: internal-only, revoked from public/anon/authenticated).

-- ── Coupons: can't build a catalog you can't legitimately use ──────────────
create or replace function create_coupon(
  p_cafe_id       uuid,
  p_code          text,
  p_name          text,
  p_kind          text,
  p_value         integer,
  p_min_order     integer default 0,
  p_max_discount  integer default null,
  p_starts_at     timestamptz default null,
  p_ends_at       timestamptz default null,
  p_usage_limit   integer default null,
  p_per_customer  integer default null,
  p_category_ids  uuid[] default null
) returns coupons
language plpgsql security definer set search_path = public as $$
declare
  v_role member_role;
  v_code text;
  v_row  coupons%rowtype;
  v_cid  uuid;
begin
  select role into v_role from cafe_members where cafe_id = p_cafe_id and user_id = auth.uid();
  if v_role is null then raise exception 'not authorized for this café'; end if;
  if v_role not in ('owner', 'manager') then
    raise exception 'only an owner or manager can create coupons';
  end if;
  if not cafe_has_feature(p_cafe_id, 'coupons') then
    raise exception 'coupons are not available on this café''s plan';
  end if;

  v_code := upper(trim(coalesce(p_code, '')));
  if v_code = '' then raise exception 'enter a coupon code'; end if;
  if p_kind not in ('percent', 'flat') then
    raise exception 'only percent or flat coupons are supported';
  end if;
  if p_kind = 'percent' and (p_value <= 0 or p_value > 100) then
    raise exception 'a percent coupon needs a value between 1 and 100';
  end if;
  if p_kind = 'flat' and p_value <= 0 then
    raise exception 'a flat coupon needs a value greater than 0';
  end if;
  if coalesce(p_min_order, 0) < 0 then raise exception 'minimum order cannot be negative'; end if;
  if p_max_discount is not null and p_max_discount <= 0 then
    raise exception 'maximum discount must be greater than 0';
  end if;
  if p_starts_at is not null and p_ends_at is not null and p_ends_at <= p_starts_at then
    raise exception 'end date must be after the start date';
  end if;
  if p_usage_limit is not null and p_usage_limit <= 0 then
    raise exception 'usage limit must be greater than 0';
  end if;
  if p_per_customer is not null and p_per_customer <= 0 then
    raise exception 'per-customer limit must be greater than 0';
  end if;

  insert into coupons (cafe_id, code, name, kind, value, min_order, max_discount,
                        starts_at, ends_at, usage_limit, per_customer)
  values (p_cafe_id, v_code, nullif(trim(coalesce(p_name, '')), ''), p_kind::coupon_kind, p_value,
          coalesce(p_min_order, 0), p_max_discount, p_starts_at, p_ends_at, p_usage_limit, p_per_customer)
  returning * into v_row;

  foreach v_cid in array coalesce(p_category_ids, array[]::uuid[]) loop
    if not exists (select 1 from menu_categories where id = v_cid and cafe_id = p_cafe_id) then continue; end if;
    insert into coupon_categories (coupon_id, category_id) values (v_row.id, v_cid)
      on conflict do nothing;
  end loop;

  return v_row;
end $$;
-- Grants unchanged (authenticated only).

-- ── Loyalty: can't build a rewards catalog you can't legitimately use ──────
create or replace function create_reward(
  p_cafe_id      uuid,
  p_name         text,
  p_points_cost  integer,
  p_menu_item_id uuid default null,
  p_variant_id   uuid default null
) returns rewards
language plpgsql security definer set search_path = public as $$
declare
  v_role         member_role;
  v_row          rewards%rowtype;
  v_has_variants boolean;
begin
  select role into v_role from cafe_members where cafe_id = p_cafe_id and user_id = auth.uid();
  if v_role is null then raise exception 'not authorized for this café'; end if;
  if v_role not in ('owner', 'manager') then
    raise exception 'only an owner or manager can create rewards';
  end if;
  if not cafe_has_feature(p_cafe_id, 'loyalty') then
    raise exception 'loyalty rewards are not available on this café''s plan';
  end if;

  if p_name is null or trim(p_name) = '' then raise exception 'enter a reward name'; end if;
  if p_points_cost is null or p_points_cost <= 0 then raise exception 'points cost must be greater than 0'; end if;

  if p_menu_item_id is not null then
    if not exists (select 1 from menu_items where id = p_menu_item_id and cafe_id = p_cafe_id and archived = false) then
      raise exception 'menu item not found';
    end if;

    v_has_variants := exists (select 1 from menu_item_variants where menu_item_id = p_menu_item_id);
    if v_has_variants and p_variant_id is null then
      raise exception 'this item has sizes — pick one for the reward';
    end if;
    if p_variant_id is not null and not exists (
      select 1 from menu_item_variants where id = p_variant_id and menu_item_id = p_menu_item_id
    ) then
      raise exception 'invalid variant for this item';
    end if;
  elsif p_variant_id is not null then
    raise exception 'a variant needs an item to belong to';
  end if;

  insert into rewards (cafe_id, name, points_cost, menu_item_id, variant_id)
  values (p_cafe_id, trim(p_name), p_points_cost, p_menu_item_id, p_variant_id)
  returning * into v_row;

  return v_row;
end $$;
-- Grants unchanged (authenticated only).

-- ── Loyalty: standalone (no-menu-item) redemption path ──────────────────────
create or replace function redeem_reward(
  p_cafe_id        uuid,
  p_customer_phone text,
  p_reward_id      uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_phone         text;
  v_customer_id   uuid;
  v_customer_name text;
  v_account       uuid;
  v_balance       integer;
  v_reward        rewards%rowtype;
begin
  if not is_cafe_member(p_cafe_id) then
    raise exception 'not authorized for this café';
  end if;
  if not cafe_has_feature(p_cafe_id, 'loyalty') then
    raise exception 'loyalty rewards are not available on this café''s plan';
  end if;

  v_phone := nullif(regexp_replace(coalesce(p_customer_phone, ''), '\D', '', 'g'), '');
  if v_phone is null then raise exception 'a customer phone number is required'; end if;

  select id, name into v_customer_id, v_customer_name
    from customers where cafe_id = p_cafe_id and phone = v_phone;
  if v_customer_id is null then raise exception 'no customer found with this phone number'; end if;

  select * into v_reward from rewards where id = p_reward_id and cafe_id = p_cafe_id;
  if v_reward.id is null then raise exception 'reward not found'; end if;
  if not v_reward.active then raise exception 'this reward is no longer available'; end if;

  v_account := get_or_create_loyalty_account(p_cafe_id, v_customer_id);

  select coalesce(sum(points), 0) into v_balance from loyalty_transactions where account_id = v_account;
  if v_balance < v_reward.points_cost then
    raise exception '% has % points — this reward needs %',
      coalesce(v_customer_name, 'this customer'), v_balance, v_reward.points_cost;
  end if;

  insert into loyalty_transactions (cafe_id, account_id, order_id, kind, points, reason)
  values (p_cafe_id, v_account, null, 'redeem', -v_reward.points_cost, 'Redeemed: ' || v_reward.name);

  return jsonb_build_object(
    'customer_id', v_customer_id, 'reward', v_reward.name,
    'points_spent', v_reward.points_cost, 'new_balance', v_balance - v_reward.points_cost);
end $$;
-- Grants unchanged (authenticated only).

-- ── Spin wheel: can't configure/activate a wheel you can't legitimately use ─
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
  if not cafe_has_feature(p_cafe_id, 'loyalty') then
    raise exception 'the spin wheel is not available on this café''s plan';
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

  if v_wheel.active and v_total = 0 then
    raise exception 'give at least one slice a chance above zero before switching the wheel on';
  end if;

  return v_wheel;
end $$;
-- Grants unchanged (authenticated only).

-- ── Spin wheel: the actual draw (anon-callable — same 0092-style inline
--     precedence check, since cafe_has_feature() cannot see an anon caller
--     as a member of anything). ────────────────────────────────────────────
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
-- Grants unchanged (anon, authenticated).

-- ── Spin wheel: claiming a prize at the till ────────────────────────────────
create or replace function redeem_spin_prize(p_cafe_id uuid, p_code text, p_order_id uuid default null)
returns spin_results
language plpgsql security definer set search_path = public as $$
declare v_r spin_results%rowtype;
begin
  if not exists (select 1 from cafe_members where cafe_id = p_cafe_id and user_id = auth.uid()) then
    raise exception 'not authorized for this café';
  end if;
  if not cafe_has_feature(p_cafe_id, 'loyalty') then
    raise exception 'the spin wheel is not available on this café''s plan';
  end if;

  perform pg_advisory_xact_lock(hashtext('spinclaim:' || p_cafe_id::text || ':' || upper(trim(p_code))));

  select * into v_r from spin_results
   where cafe_id = p_cafe_id and upper(code) = upper(trim(p_code)) for update;
  if not found then raise exception 'no prize with that code'; end if;
  if v_r.redeemed_at is not null then raise exception 'that prize has already been claimed'; end if;
  if v_r.expires_at is not null and v_r.expires_at < now() then raise exception 'that prize has expired'; end if;
  if v_r.kind = 'none' then raise exception 'that spin did not win anything'; end if;

  update spin_results
     set redeemed_at = now(), redeemed_by = auth.uid(), redeemed_order_id = p_order_id
   where id = v_r.id
  returning * into v_r;

  return v_r;
end $$;
-- Grants unchanged (authenticated only).

-- ── staff_place_order: byte-for-byte identical to its current live body
--     (0126) except the one entitlement check added inside the reward
--     branch — this is the ONLY new authorization line in this function. ───
create or replace function staff_place_order(
  p_cafe_id           uuid,
  p_items             jsonb,
  p_order_type        order_type default 'dine_in',
  p_table_id          uuid default null,
  p_payment_method    text default 'counter',
  p_customer_phone    text default null,
  p_customer_name     text default null,
  p_discount_type     text default null,
  p_discount_value    numeric default 0,
  p_settle            boolean default false,
  p_pending_reason    text default null,
  p_client_request_id uuid default null,
  p_coupon_code       text default null,
  p_spin_code         text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role          member_role;
  v_max_pct       numeric;
  v_session_id    uuid;
  v_customer_id   uuid;
  v_phone         text;
  v_order_id      uuid;
  v_receipt       uuid;
  v_subtotal      integer := 0;
  v_net_subtotal  integer := 0;
  v_discount      integer := 0;
  v_disc_pct_eq   numeric;
  v_tax           integer;
  v_svc           integer;
  v_total         integer;
  v_seq           integer;
  v_day_start     timestamptz;
  v_item          jsonb;
  v_qty           integer;
  v_id            uuid;
  v_name          text;
  v_price         integer;
  v_unit          integer;
  v_mods          jsonb;
  v_note          text;
  v_has_variants  boolean;
  v_variant_id    uuid;
  v_vname         text;
  v_vdelta        integer;
  v_addon         text;
  v_aname         text;
  v_aprice        integer;
  v_settled       boolean := false;
  v_existing      record;
  v_coupon        jsonb;
  v_coupon_disc   integer := 0;
  v_cat_ids       uuid[];
  v_reward_id     uuid;
  v_reward        rewards%rowtype;
  v_account       uuid;
  v_needed        integer;
  v_balance       integer;
  v_combo_id      uuid;
  v_combo_savings integer := 0;
  v_spin          spin_results%rowtype;
  v_spin_disc     integer := 0;
begin
  select role into v_role from cafe_members where cafe_id = p_cafe_id and user_id = auth.uid();
  if v_role is null then
    raise exception 'not authorized for this café';
  end if;
  if p_order_type not in ('dine_in', 'takeaway') then
    raise exception 'invalid order type';
  end if;
  if p_payment_method not in ('counter', 'cash', 'card', 'upi') then
    raise exception 'invalid payment method';
  end if;
  if p_order_type = 'dine_in' and p_table_id is null then
    raise exception 'table required for a dine-in order';
  end if;
  if p_order_type = 'takeaway' and p_table_id is not null then
    raise exception 'a takeaway order must not be attached to a table';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'empty order';
  end if;

  if p_client_request_id is not null then
    select id, short_code, subtotal, discount, tax, service_charge, total, receipt_token, payment_status
      into v_existing
      from orders where cafe_id = p_cafe_id and client_request_id = p_client_request_id;
    if found then
      return jsonb_build_object('order_id', v_existing.id, 'short_code', v_existing.short_code,
                                 'subtotal', v_existing.subtotal, 'discount', v_existing.discount,
                                 'tax', v_existing.tax, 'service_charge', v_existing.service_charge,
                                 'total', v_existing.total, 'receipt_token', v_existing.receipt_token,
                                 'settled', v_existing.payment_status = 'paid',
                                 'payment_status', v_existing.payment_status);
    end if;
  end if;

  if p_order_type = 'dine_in' then
    v_session_id := get_or_create_session(p_cafe_id, p_table_id);
  end if;

  v_phone := nullif(regexp_replace(coalesce(p_customer_phone, ''), '\D', '', 'g'), '');
  if v_phone is not null and v_phone !~ '^[6-9][0-9]{9}$' then
    raise exception 'invalid phone number';
  end if;
  if v_phone is not null then
    insert into customers (cafe_id, phone, name, last_seen)
    values (p_cafe_id, v_phone, nullif(trim(coalesce(p_customer_name, '')), ''), now())
    on conflict (cafe_id, phone) do update
      set last_seen = now(),
          name = coalesce(nullif(trim(coalesce(p_customer_name, '')), ''), customers.name)
    returning id into v_customer_id;
  end if;

  v_day_start := cafe_day_start(p_cafe_id);
  select count(*) + 1 into v_seq from orders
    where cafe_id = p_cafe_id and status <> 'cancelled' and created_at >= v_day_start;

  insert into orders (cafe_id, table_id, session_id, customer_id, short_code, type, status,
                      payment_status, phone, payment_method, staff_id, subtotal, total, source, client_request_id)
    values (p_cafe_id, p_table_id, v_session_id, v_customer_id, v_seq::text, p_order_type, 'placed',
            'unpaid', v_phone, p_payment_method::payment_method, auth.uid(), 0, 0, 'pos', p_client_request_id)
    returning id, receipt_token into v_order_id, v_receipt;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(1, coalesce((v_item->>'qty')::int, 1));

    v_combo_id := nullif(v_item->>'combo_id', '')::uuid;
    if v_combo_id is not null then
      v_combo_savings := v_combo_savings + expand_combo_line(
        v_order_id, p_cafe_id, v_combo_id, coalesce(v_item->'selections', '[]'::jsonb), v_qty);
      continue;
    end if;

    select id, name, price into v_id, v_name, v_price
      from menu_items
      where id = (v_item->>'item_id')::uuid
        and cafe_id = p_cafe_id and available = true and archived = false;
    if v_id is null then raise exception 'item not available'; end if;

    v_unit := v_price;
    v_mods := '[]'::jsonb;

    v_has_variants := exists (select 1 from menu_item_variants where menu_item_id = v_id);
    v_variant_id := nullif(v_item->>'variant_id', '')::uuid;
    if v_has_variants and v_variant_id is null then
      raise exception 'variant required for %', v_name;
    end if;
    if v_variant_id is not null then
      select name, price_delta into v_vname, v_vdelta
        from menu_item_variants where id = v_variant_id and menu_item_id = v_id;
      if v_vname is null then raise exception 'invalid variant'; end if;
      v_unit := v_unit + v_vdelta;
      v_mods := v_mods || jsonb_build_object('name', v_vname, 'price', v_vdelta);
      v_name := v_name || ' (' || v_vname || ')';
    end if;

    -- Reward redemption (0120): resolved before addons so a free line can
    -- never pick up chargeable addon value on top of the ₹0 price. The
    -- feature check is the ONE new line in this function (0143) — every
    -- non-owner/manager caller was already rejected above; this additionally
    -- rejects a café whose plan doesn't include loyalty at all, closing the
    -- same "hidden button is not a security boundary" gap 0143 fixes for
    -- coupons via resolve_coupon_discount and for the standalone reward path
    -- via redeem_reward.
    v_reward_id := nullif(v_item->>'reward_id', '')::uuid;
    if v_reward_id is not null then
      if not cafe_has_feature(p_cafe_id, 'loyalty') then
        raise exception 'loyalty rewards are not available on this café''s plan';
      end if;
      select * into v_reward from rewards where id = v_reward_id and cafe_id = p_cafe_id;
      if v_reward.id is null then raise exception 'reward not found'; end if;
      if not v_reward.active then raise exception 'reward "%" is no longer available', v_reward.name; end if;
      if v_reward.menu_item_id is distinct from v_id then
        raise exception 'reward "%" does not apply to this item', v_reward.name;
      end if;
      if v_reward.variant_id is distinct from v_variant_id then
        raise exception 'reward "%" requires a different variant', v_reward.name;
      end if;
      v_unit := 0;
    end if;

    if v_reward_id is null and v_item ? 'addon_ids' then
      for v_addon in select jsonb_array_elements_text(v_item->'addon_ids') loop
        select name, price into v_aname, v_aprice
          from menu_item_addons where id = v_addon::uuid and menu_item_id = v_id;
        if v_aname is null then raise exception 'invalid add-on'; end if;
        v_unit := v_unit + v_aprice;
        v_mods := v_mods || jsonb_build_object('name', v_aname, 'price', v_aprice);
      end loop;
    end if;

    v_note := nullif(trim(coalesce(v_item->>'note', '')), '');

    insert into order_items (order_id, menu_item_id, name, price, qty, modifiers, instructions, variant_id, reward_id)
      values (v_order_id, v_id, v_name, v_unit, v_qty, v_mods, v_note, v_variant_id, v_reward_id);

    if v_reward_id is not null then
      if v_customer_id is null then
        raise exception 'a customer phone number is required to redeem a reward';
      end if;
      v_account := get_or_create_loyalty_account(p_cafe_id, v_customer_id);
      perform pg_advisory_xact_lock(hashtext('loyalty:' || v_account::text));
      v_needed := v_reward.points_cost * v_qty;
      select coalesce(sum(points), 0) into v_balance from loyalty_transactions where account_id = v_account;
      if v_balance < v_needed then
        raise exception 'not enough points to redeem "%" — % needed, % available', v_reward.name, v_needed, v_balance;
      end if;
      insert into loyalty_transactions (cafe_id, account_id, order_id, kind, points, reason)
      values (p_cafe_id, v_account, v_order_id, 'redeem', -v_needed, 'Redeemed: ' || v_reward.name);
    end if;
  end loop;

  select coalesce(sum(price * qty), 0) into v_subtotal
    from order_items where order_id = v_order_id;
  v_net_subtotal := greatest(0, v_subtotal - v_combo_savings);

  v_max_pct := case v_role when 'owner' then 100 when 'manager' then 15 else 5 end;

  if p_discount_type is not null and p_discount_type not in ('percent', 'flat') then
    raise exception 'invalid discount type';
  end if;

  if p_discount_type = 'percent' and p_discount_value > 0 then
    if p_discount_value > v_max_pct then
      raise exception 'your role can discount at most % percent (requested %)', v_max_pct, p_discount_value;
    end if;
    v_discount := round(v_net_subtotal * p_discount_value / 100.0);
  elsif p_discount_type = 'flat' and p_discount_value > 0 then
    v_disc_pct_eq := case when v_net_subtotal > 0 then (p_discount_value * 100.0 / v_net_subtotal) else 0 end;
    if v_disc_pct_eq > v_max_pct then
      raise exception 'your role can discount at most % percent of the subtotal', v_max_pct;
    end if;
    v_discount := round(p_discount_value);
  end if;

  if p_spin_code is not null and trim(p_spin_code) <> '' then
    v_spin := redeem_spin_prize(p_cafe_id, p_spin_code, v_order_id);

    if v_spin.kind = 'item' then
      select oi.price into v_spin_disc
        from order_items oi
       where oi.order_id = v_order_id
         and oi.menu_item_id = v_spin.menu_item_id
         and (v_spin.variant_id is null or oi.variant_id = v_spin.variant_id)
       order by oi.price desc
       limit 1;
      if v_spin_disc is null then
        raise exception 'add "%" to the bill before claiming this prize', v_spin.label;
      end if;
    elsif v_spin.kind = 'percent' then
      v_spin_disc := round(v_net_subtotal * v_spin.value / 100.0);
    elsif v_spin.kind = 'flat' then
      v_spin_disc := v_spin.value;
    end if;

    v_discount := v_discount + greatest(0, coalesce(v_spin_disc, 0));

    insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
    values (p_cafe_id, auth.uid(), 'spin.prize_claimed', 'orders', v_order_id,
            jsonb_build_object('code', upper(trim(p_spin_code)), 'label', v_spin.label,
                               'kind', v_spin.kind, 'amount', v_spin_disc));
  end if;

  if p_coupon_code is not null and trim(p_coupon_code) <> '' then
    perform pg_advisory_xact_lock(hashtext('coupon:' || p_cafe_id::text || ':' || upper(trim(p_coupon_code))));
    select coalesce(array_agg(distinct mi.category_id), array[]::uuid[]) into v_cat_ids
      from order_items oi join menu_items mi on mi.id = oi.menu_item_id
      where oi.order_id = v_order_id and mi.category_id is not null;
    v_coupon := resolve_coupon_discount(p_cafe_id, p_coupon_code, v_net_subtotal, v_customer_id, v_cat_ids);
    v_coupon_disc := (v_coupon->>'discount')::integer;
    v_discount := v_discount + v_coupon_disc;
  end if;

  if v_discount > 0 then
    insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
    values (p_cafe_id, auth.uid(), 'order.discount_applied', 'orders', v_order_id,
            jsonb_build_object('type', p_discount_type, 'requested', p_discount_value,
                                'amount', v_discount, 'role', v_role,
                                'spin_amount', nullif(v_spin_disc, 0),
                                'coupon_code', case when v_coupon is not null then v_coupon->>'code' end));
  end if;

  select t.subtotal, t.discount, t.tax, t.service_charge, t.total
    into v_subtotal, v_discount, v_tax, v_svc, v_total
    from apply_order_taxes(v_order_id, v_combo_savings + v_discount) t;

  if v_coupon is not null then
    update orders set coupon_code = v_coupon->>'code' where id = v_order_id;
    insert into coupon_redemptions (cafe_id, coupon_id, order_id, customer_id, discount_amount)
    values (p_cafe_id, (v_coupon->>'coupon_id')::uuid, v_order_id, v_customer_id, v_coupon_disc);
  end if;

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (p_cafe_id, auth.uid(), 'order.created', 'orders', v_order_id,
          jsonb_build_object('source', 'pos', 'total', v_total, 'order_type', p_order_type, 'table_id', p_table_id));

  if p_settle then
    if p_payment_method not in ('cash', 'card', 'upi') then
      raise exception 'to collect payment now, choose cash, card or UPI';
    end if;
    if v_total > 0 then
      perform record_payment(v_order_id, v_total, p_payment_method, null, 'pos', null);
      v_settled := true;
    end if;
  else
    update orders set payment_method = 'counter' where id = v_order_id;
    if p_order_type = 'takeaway' then
      insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
      values (p_cafe_id, auth.uid(), 'order.payment_pending', 'orders', v_order_id,
              jsonb_build_object('reason', nullif(trim(coalesce(p_pending_reason, '')), ''),
                                 'total', v_total, 'order_type', p_order_type));
    end if;
  end if;

  insert into notifications (cafe_id, type, message, table_id, session_id)
  select p_cafe_id, 'new_order',
         case when p_order_type = 'takeaway' then 'New takeaway order — #' || v_seq
              else 'Table ' || t.label || ' — new counter order #' || v_seq end,
         p_table_id, v_session_id
  from cafe_tables t where t.id = p_table_id
  union all
  select p_cafe_id, 'new_order', 'New takeaway order — #' || v_seq, null, null
  where p_table_id is null;

  return jsonb_build_object('order_id', v_order_id, 'short_code', v_seq::text,
                            'subtotal', v_subtotal, 'discount', v_discount,
                            'tax', v_tax, 'service_charge', v_svc,
                            'total', v_total, 'receipt_token', v_receipt,
                            'settled', v_settled,
                            'payment_status', (select payment_status from orders where id = v_order_id));
exception
  when unique_violation then
    if p_client_request_id is not null then
      select id, short_code, subtotal, discount, tax, service_charge, total, receipt_token, payment_status
        into v_existing
        from orders where cafe_id = p_cafe_id and client_request_id = p_client_request_id;
      if found then
        return jsonb_build_object('order_id', v_existing.id, 'short_code', v_existing.short_code,
                                   'subtotal', v_existing.subtotal, 'discount', v_existing.discount,
                                   'tax', v_existing.tax, 'service_charge', v_existing.service_charge,
                                   'total', v_existing.total, 'receipt_token', v_existing.receipt_token,
                                   'settled', v_existing.payment_status = 'paid',
                                   'payment_status', v_existing.payment_status);
      end if;
    end if;
    raise;
end $$;
-- Grants unchanged (authenticated only).
