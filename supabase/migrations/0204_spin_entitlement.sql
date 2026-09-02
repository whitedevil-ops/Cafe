-- ============================================================================
-- 0204 — Spin & Win becomes its own sellable feature ('spin'), instead of
-- informally riding on the 'loyalty' entitlement.
--
-- WHY (two separate problems, one fix):
--
--   1. COMMERCIAL: Spin & Win had no entitlement key at all. It was bundled
--      into 'loyalty' by convention only, so it could not be sold, trialled
--      or switched off for one café without dragging points and rewards
--      along with it. The operator panel deliberately listed no toggle for
--      it (see the comment above FEATURES in
--      app/ops/cafes/[id]/cafe-detail-client.tsx) precisely because a toggle
--      on a key nothing read would have silently done nothing.
--
--   2. A REAL ENFORCEMENT GAP: save_spin_wheel (staff-facing) has checked
--      cafe_has_feature(..., 'loyalty') since 0143, and spin_the_wheel
--      inlines the same check for anonymous callers — but get_spin_wheel,
--      the guest-facing read every receipt page hits, gated ONLY on
--      spin_wheels.active and checked no entitlement whatsoever. A café
--      downgraded off-plan could no longer EDIT its wheel, yet its guests
--      still saw a live wheel on their receipt. They were then rejected at
--      spin_the_wheel — a broken promise shown to the customer, which is
--      worse than never showing the wheel.
--
-- SEEDING IS MANDATORY, NOT COSMETIC: a missing key resolves to false
-- (`coalesce((features ->> p_feature)::boolean, false)`), so adding a 'spin'
-- check without seeding would instantly kill Spin & Win for every café on
-- the platform. Each plan is seeded with its OWN CURRENT 'loyalty' value, so
-- today's intended entitlement is preserved exactly (pro/business on,
-- trial/starter off) while becoming independently controllable from here on.
--
-- Deliberately NOT changed: 'loyalty' itself keeps its value everywhere, and
-- points/rewards stay gated on it. redeem_spin_prize (0147) also still gates
-- on 'loyalty' — a café mid-downgrade must be able to honour prize codes it
-- already handed to customers, so that one is left alone on purpose.
-- ============================================================================

-- ── 1. Seed 'spin' from each plan's current 'loyalty' value ────────────────
-- Idempotent by construction: only rows that don't already carry the key are
-- touched, so a re-run never clobbers a value an operator has since changed.
-- Every row is seeded, including inactive plans — an inactive plan brought
-- back later must not come back missing the key.
update platform_plans
   set features = jsonb_set(
         features, '{spin}',
         to_jsonb(coalesce((features ->> 'loyalty')::boolean, false)),
         true
       )
 where not (features ? 'spin');

-- ── 2. A guest-safe entitlement read ───────────────────────────────────────
-- cafe_has_feature (0019) fails closed for anyone who is not a member of the
-- café or a platform admin. That is correct for staff RPCs and completely
-- unusable for guest-facing ones: an anonymous customer has no auth.uid(),
-- so it would always return false and deny everybody (the exact trap that
-- bit wallet_start_topup in 0092 and that 0143 worked around by inlining the
-- lookup in each anon-callable function).
--
-- The MISSING membership check is the entire point of this function, so it
-- is stated rather than implied: this returns a boolean about a CAFÉ'S OWN
-- PLAN and nothing else — never customer data, never anything tenant-
-- specific beyond "is this feature on for this café". The caller must
-- already have established which café it is talking about (a receipt token,
-- a table token) — this function is not an authorization check and must
-- never be used as one.
--
-- Precedence is identical to cafe_has_feature and to
-- public_cafe_ordering_enabled (0103): an explicit per-café override wins
-- outright, otherwise the café's plan decides, otherwise false.
create or replace function cafe_feature_for_guest(p_cafe_id uuid, p_feature text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_override      boolean;
  v_plan_key      text;
  v_plan_features jsonb;
begin
  select enabled into v_override from cafe_feature_overrides
    where cafe_id = p_cafe_id and feature_key = p_feature;
  if v_override is not null then return v_override; end if;

  select plan into v_plan_key from cafes where id = p_cafe_id;
  select features into v_plan_features from platform_plans where key = v_plan_key;
  if v_plan_features is null then return false; end if;
  return coalesce((v_plan_features ->> p_feature)::boolean, false);
end $$;

-- Granted to NOBODY, deliberately. Without a membership check, a direct
-- grant to authenticated would let any signed-in user probe any café's
-- entitlements by cafe_id — the cross-tenant leak cafe_has_feature's own
-- member check exists to prevent. The guest-facing functions below are
-- SECURITY DEFINER, so they call this as the owner and need no grant here.
revoke execute on function cafe_feature_for_guest(uuid, text) from public, anon, authenticated;

-- ── 3. get_spin_wheel: close the guest-facing gap ──────────────────────────
-- Current definition taken from 0189 (subtitle/min_order_amount/confetti/
-- sound payload); the only change is the entitlement check, which returns
-- the EXACT shape an inactive wheel already returns —
-- jsonb_build_object('available', false) — so every existing caller
-- (app/r/[token], the QR menu's receipt view) handles it with no client
-- change at all: off-plan simply looks like "no wheel here", which is the
-- truth.
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

  if not cafe_feature_for_guest(v_order.cafe_id, 'spin') then
    return jsonb_build_object('available', false);
  end if;

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

-- ── 4. spin_the_wheel: same check, now on 'spin' ───────────────────────────
-- Current definition taken from 0191 (per-prize claim limits, the lock-then-
-- re-check claim race fix, the sold-out fallback outcome). The only change
-- is the entitlement block at the top: the hand-inlined override-then-plan
-- lookup on 'loyalty' is replaced by cafe_feature_for_guest(..., 'spin') —
-- same precedence, one implementation instead of a copy, and its three local
-- variables (v_feat_override / v_plan_key / v_plan_features) go with it. The
-- failure message is unchanged and still matches the one an inactive wheel
-- raises further down, so nothing new leaks about the café's plan.
create or replace function spin_the_wheel(p_receipt_token uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_order         orders%rowtype;
  v_wheel         spin_wheels%rowtype;
  v_total         integer;
  v_roll          integer;
  v_seg           spin_segments%rowtype;
  v_locked        spin_segments%rowtype;
  v_code          text;
  v_result        spin_results%rowtype;
  v_alphabet      constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_i             integer;
  v_try           integer;
  v_attempt       integer;
  v_expiry_days   integer;
  v_remaining     integer;
  v_all_sold_out  boolean;
begin
  select * into v_order from orders where receipt_token = p_receipt_token;
  if not found then raise exception 'order not found'; end if;

  if not cafe_feature_for_guest(v_order.cafe_id, 'spin') then
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

  v_seg := null;
  for v_attempt in 1..5 loop
    select coalesce(sum(weight), 0) into v_total
      from spin_segments where wheel_id = v_wheel.id and (max_claims is null or claims_used < max_claims);

    if v_total <= 0 then
      -- Nothing left to win, on any attempt including the first — every
      -- real prize is sold out (or the wheel is only "none" slices with
      -- zero weight, an owner-config edge case treated the same way).
      v_seg := null;
      exit;
    end if;

    v_roll := floor(random() * v_total)::integer;
    select s.* into v_seg from (
      select seg.*, sum(seg.weight) over (order by seg.sort, seg.id) as cum
      from spin_segments seg where seg.wheel_id = v_wheel.id and (seg.max_claims is null or seg.claims_used < seg.max_claims)
    ) s where s.cum > v_roll order by s.cum limit 1;

    if v_seg.kind = 'none' or v_seg.max_claims is null then
      -- No claim accounting needed — either a losing slice, or unlimited.
      exit;
    end if;

    -- Lock the specific slice and re-check under the lock: the pool read
    -- above is a plain read with no lock, so a concurrent spin could have
    -- claimed the very last unit of this exact slice in between. Retrying
    -- the whole draw (not just re-checking this one slice) is deliberate —
    -- the available pool itself may have changed too.
    select * into v_locked from spin_segments where id = v_seg.id for update;
    if v_locked.max_claims is null or v_locked.claims_used < v_locked.max_claims then
      update spin_segments set claims_used = claims_used + 1 where id = v_seg.id returning * into v_locked;
      v_seg := v_locked;
      exit;
    end if;
    -- Lost the race for this slice — loop and redraw from the now-current pool.
    v_seg := null;
  end loop;

  if v_seg is null then
    -- Either genuinely sold out, or five straight unlucky races (practically
    -- impossible at real traffic) — either way, "Better luck next time" is
    -- always a safe, correct fallback outcome, never an error the guest sees.
    v_code := 'W' || upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 5));
    insert into spin_results (cafe_id, segment_id, order_id, customer_id, label, kind, menu_item_id, variant_id, value, code, expires_at)
    values (v_order.cafe_id, null, v_order.id, v_order.customer_id, 'Better luck next time', 'none', null, null, 0, v_code, null)
    returning * into v_result;
    return jsonb_build_object('segment_id', null, 'label', v_result.label, 'kind', 'none', 'value', 0, 'code', v_result.code, 'expires_at', null);
  end if;

  for v_try in 1..8 loop
    v_code := 'W';
    for v_i in 1..5 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::integer, 1);
    end loop;
    exit when not exists (select 1 from spin_results where cafe_id = v_order.cafe_id and code = v_code);
  end loop;

  v_expiry_days := coalesce(v_seg.expiry_days, v_wheel.expiry_days);

  insert into spin_results (
    cafe_id, segment_id, order_id, customer_id,
    label, kind, menu_item_id, variant_id, value, code, expires_at
  ) values (
    v_order.cafe_id, v_seg.id, v_order.id, v_order.customer_id,
    v_seg.label, v_seg.kind, v_seg.menu_item_id, v_seg.variant_id, v_seg.value, v_code,
    case when v_expiry_days is null then null else now() + (v_expiry_days || ' days')::interval end
  ) returning * into v_result;

  -- One notification per available→sold-out transition: claims_used just
  -- became exactly max_claims (not >, so a second concurrent winner on the
  -- same slice — impossible under the lock above, but kept as a guard —
  -- can't double-fire this).
  if v_seg.max_claims is not null and v_seg.claims_used = v_seg.max_claims then
    insert into platform_audit_logs (actor_id, action, target_type, target_id, new_value)
    values (null, 'cafe.spin_prize_sold_out', 'cafe', v_order.cafe_id,
            jsonb_build_object('segment_id', v_seg.id, 'label', v_seg.label, 'max_claims', v_seg.max_claims));

    select coalesce(sum(weight), 0) = 0 into v_all_sold_out
      from spin_segments where wheel_id = v_wheel.id and kind <> 'none' and (max_claims is null or claims_used < max_claims);
    if v_all_sold_out then
      insert into platform_audit_logs (actor_id, action, target_type, target_id, new_value)
      values (null, 'cafe.spin_all_prizes_sold_out', 'cafe', v_order.cafe_id, jsonb_build_object('wheel_id', v_wheel.id));
    end if;
  end if;

  return jsonb_build_object(
    'segment_id', v_result.segment_id, 'label', v_result.label, 'kind', v_result.kind,
    'value', v_result.value, 'code', v_result.code, 'expires_at', v_result.expires_at
  );
end $$;

revoke execute on function spin_the_wheel(uuid) from public;
grant execute on function spin_the_wheel(uuid) to anon, authenticated;

-- ── 5. save_spin_wheel: gate on 'spin', not 'loyalty' ──────────────────────
-- Current definition taken from 0191 (upsert-by-id segments so claims_used
-- survives a save, per-prize max_claims/expiry_days, the audit-log row).
-- Signature is unchanged, so CREATE OR REPLACE is enough — no drop needed.
-- The only change is the feature key on line one of the entitlement check.
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
  v_role       member_role;
  v_wheel      spin_wheels%rowtype;
  v_seg        jsonb;
  v_kind       text;
  v_item       uuid;
  v_seg_id     uuid;
  v_max_claims integer;
  v_used       integer;
  v_total      integer := 0;
  v_i          integer := 0;
  v_kept_ids   uuid[] := '{}';
begin
  select role into v_role from cafe_members where cafe_id = p_cafe_id and user_id = auth.uid();
  if v_role is null then raise exception 'not authorized for this café'; end if;
  if v_role not in ('owner', 'manager') then
    raise exception 'only an owner or manager can set up the spin wheel';
  end if;
  if not cafe_has_feature(p_cafe_id, 'spin') then
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

  for v_seg in select * from jsonb_array_elements(coalesce(p_segments, '[]'::jsonb)) loop
    v_kind := v_seg->>'kind';
    v_item := nullif(v_seg->>'menu_item_id', '')::uuid;
    v_seg_id := nullif(v_seg->>'id', '')::uuid;
    v_max_claims := nullif(v_seg->>'max_claims', '')::integer;
    if v_max_claims is not null and v_max_claims <= 0 then
      raise exception '"%" — maximum claims must be a positive number', v_seg->>'label';
    end if;

    if coalesce(trim(v_seg->>'label'), '') = '' then raise exception 'every slice needs a label'; end if;
    if v_kind not in ('item', 'percent', 'flat', 'none') then raise exception 'unknown prize type "%"', v_kind; end if;

    if v_kind = 'item' then
      if v_item is null then raise exception 'pick the item for "%"', v_seg->>'label'; end if;
      if not exists (select 1 from menu_items where id = v_item and cafe_id = p_cafe_id) then
        raise exception 'that item is not on this café''s menu';
      end if;
    end if;

    -- Does this id belong to a real, existing segment on THIS wheel? A
    -- client-forged id from another café's wheel is silently treated as
    -- "new" (v_seg_id left pointing nowhere real), never as a match.
    v_used := null;
    if v_seg_id is not null then
      select claims_used into v_used from spin_segments where id = v_seg_id and wheel_id = v_wheel.id;
    end if;

    if v_used is not null then
      -- Existing segment: update in place. claims_used is deliberately
      -- absent from this SET list — untouched by definition.
      if v_max_claims is not null and v_max_claims < v_used then
        raise exception '"%" already has %s claims — the maximum can''t be set below that', v_seg->>'label', v_used;
      end if;
      update spin_segments set
        label = trim(v_seg->>'label'), kind = v_kind, menu_item_id = v_item,
        variant_id = nullif(v_seg->>'variant_id', '')::uuid,
        value = greatest(0, coalesce((v_seg->>'value')::integer, 0)),
        weight = greatest(0, coalesce((v_seg->>'weight')::integer, 1)),
        sort = v_i,
        color = nullif(trim(v_seg->>'color'), ''),
        max_claims = v_max_claims,
        expiry_days = nullif(v_seg->>'expiry_days', '')::integer
      where id = v_seg_id;
      v_kept_ids := v_kept_ids || v_seg_id;
    else
      insert into spin_segments (wheel_id, label, kind, menu_item_id, variant_id, value, weight, sort, color, max_claims, expiry_days)
      values (
        v_wheel.id, trim(v_seg->>'label'), v_kind, v_item,
        nullif(v_seg->>'variant_id', '')::uuid,
        greatest(0, coalesce((v_seg->>'value')::integer, 0)),
        greatest(0, coalesce((v_seg->>'weight')::integer, 1)),
        v_i, nullif(trim(v_seg->>'color'), ''), v_max_claims, nullif(v_seg->>'expiry_days', '')::integer
      ) returning id into v_seg_id;
      v_kept_ids := v_kept_ids || v_seg_id;
    end if;

    v_total := v_total + greatest(0, coalesce((v_seg->>'weight')::integer, 1));
    v_i := v_i + 1;
  end loop;

  -- Anything that existed before and isn't in the new payload was removed
  -- by the owner. Historical spin_results referencing it survive via
  -- segment_id's existing "on delete set null" — unchanged from before.
  delete from spin_segments
   where wheel_id = v_wheel.id and not (id = any(v_kept_ids));

  if v_wheel.active and v_total = 0 then
    raise exception 'give at least one slice a chance above zero before switching the wheel on';
  end if;

  insert into platform_audit_logs (actor_id, action, target_type, target_id, new_value)
  values (auth.uid(), 'cafe.spin_wheel_changed', 'cafe', p_cafe_id, jsonb_build_object('title', v_wheel.title, 'active', v_wheel.active));

  return v_wheel;
end $$;

revoke execute on function save_spin_wheel(uuid, text, text, boolean, integer, integer, boolean, boolean, jsonb) from public, anon;
grant execute on function save_spin_wheel(uuid, text, text, boolean, integer, integer, boolean, boolean, jsonb) to authenticated;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
declare
  v_count   integer;
  v_missing text;
begin
  -- A plan missing the key resolves to false, i.e. Spin & Win silently off
  -- for every café on it. That must be impossible to ship.
  select string_agg(key, ', ') into v_missing
    from platform_plans where active and not (features ? 'spin');
  if v_missing is not null then
    raise exception 'platform_plans missing the "spin" feature key: % -- every café on those plans would lose Spin & Win', v_missing;
  end if;

  -- Exactly one of each, or an ambiguous-overload bug is being shipped
  -- (the same orphaned-overload class 0201''s self-check guards against).
  select count(*) into v_count from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_spin_wheel';
  if v_count <> 1 then
    raise exception 'expected exactly one get_spin_wheel, found %', v_count;
  end if;

  select count(*) into v_count from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'spin_the_wheel';
  if v_count <> 1 then
    raise exception 'expected exactly one spin_the_wheel, found %', v_count;
  end if;

  select count(*) into v_count from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_spin_wheel';
  if v_count <> 1 then
    raise exception 'expected exactly one save_spin_wheel, found %', v_count;
  end if;

  select count(*) into v_count from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'cafe_feature_for_guest';
  if v_count <> 1 then
    raise exception 'expected exactly one cafe_feature_for_guest, found % -- the guest-facing spin checks call it', v_count;
  end if;
end $$;
