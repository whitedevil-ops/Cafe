-- ============================================================================
-- 0191 — Spin & Win: per-prize claim limits, sold-out enforcement, and
-- analytics.
--
-- CRITICAL ARCHITECTURAL FIX FOUND WHILE BUILDING THIS: save_spin_wheel
-- (0125, re-bodied by 0189) is "replace-all" — every save deletes every
-- segment and re-inserts fresh rows with brand-new ids. That is fine for
-- stateless columns (label, weight, color...), but a running claims_used
-- counter CANNOT survive being deleted and recreated — editing a wheel's
-- title would have silently zeroed every prize's claim count the very next
-- time an owner touched Save. Fixed by switching save_spin_wheel from
-- delete-then-insert to a real upsert-by-id: a segment the client already
-- has an id for is UPDATED in place (claims_used is never part of that
-- update, so it's untouched); a segment with no id is a genuinely new
-- slice; any segment that existed before and is absent from the new
-- payload is deleted (the owner removed that slice — its historical
-- spin_results already survive via segment_id's existing "on delete set
-- null", frozen label/kind/value intact, same as before this migration).
-- ============================================================================

alter table spin_segments add column if not exists max_claims integer check (max_claims is null or max_claims > 0);
alter table spin_segments add column if not exists claims_used integer not null default 0 check (claims_used >= 0);
-- Per-prize expiry override. Null falls back to the wheel's own expiry_days
-- (unchanged behavior for every existing wheel, which has none of these set).
alter table spin_segments add column if not exists expiry_days integer check (expiry_days is null or expiry_days > 0);

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

-- ── spin_the_wheel: excludes any segment at its claim limit from the
-- weighted pool entirely (not a zeroed-weight slice still nominally "in
-- play" — genuinely absent from v_total and from the candidate set), atomic
-- claim-counting via a row lock + a re-check AFTER acquiring it (the same
-- "lock, then re-verify, don't trust the pre-lock read" discipline as
-- record_payment's own race fix this session), and a retry loop for the
-- rare case where the specific slice drawn was claimed out by a concurrent
-- spin between the draw and the lock — never fails the customer's spin over
-- an unlucky race, just redraws from the now-current pool. If literally
-- every real prize is sold out, synthesizes a "Better luck next time"
-- outcome directly (segment_id null) rather than erroring — the wheel must
-- always produce a result.
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
  v_feat_override boolean;
  v_plan_key      text;
  v_plan_features jsonb;
  v_has_feat      boolean;
  v_expiry_days   integer;
  v_remaining     integer;
  v_all_sold_out  boolean;
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

-- ── Owner analytics: real numbers only, computed live from spin_results +
-- the wheel's CURRENT segments (claims_used/max_claims already tracked
-- correctly per the fix above, so this is a straight read, no separate
-- bookkeeping to keep in sync). Estimated cost is deliberately conservative:
-- flat-₹ and free-item prizes have a real, fixed value; a %-off prize's
-- true cost depends on the bill it was redeemed against, which isn't
-- reliably separable from other discounts on that order, so it's counted
-- and reported separately rather than folded into a fabricated rupee total.
create or replace function spin_wheel_analytics(p_cafe_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  if not has_cafe_role(p_cafe_id, array['owner','manager']::member_role[]) then
    raise exception 'not authorized';
  end if;

  select jsonb_build_object(
    'total_spins', (select count(*) from spin_results where cafe_id = p_cafe_id and created_at >= p_from and created_at < p_to),
    'total_won', (select count(*) from spin_results where cafe_id = p_cafe_id and kind <> 'none' and created_at >= p_from and created_at < p_to),
    'total_better_luck', (select count(*) from spin_results where cafe_id = p_cafe_id and kind = 'none' and created_at >= p_from and created_at < p_to),
    'total_redeemed', (select count(*) from spin_results where cafe_id = p_cafe_id and kind <> 'none' and redeemed_at is not null and created_at >= p_from and created_at < p_to),
    'total_unredeemed', (select count(*) from spin_results where cafe_id = p_cafe_id and kind <> 'none' and redeemed_at is null and (expires_at is null or expires_at >= now()) and created_at >= p_from and created_at < p_to),
    'total_expired', (select count(*) from spin_results where cafe_id = p_cafe_id and kind <> 'none' and redeemed_at is null and expires_at is not null and expires_at < now() and created_at >= p_from and created_at < p_to),
    'estimated_flat_and_item_cost', (
      select coalesce(sum(case
        when r.kind = 'flat' then r.value
        when r.kind = 'item' then coalesce((select mi.price from menu_items mi where mi.id = r.menu_item_id), 0) + coalesce((select v.price_delta from menu_item_variants v where v.id = r.variant_id), 0)
        else 0 end), 0)
      from spin_results r where r.cafe_id = p_cafe_id and r.redeemed_at is not null and r.created_at >= p_from and r.created_at < p_to
    ),
    'percent_redemptions_uncosted', (
      select count(*) from spin_results where cafe_id = p_cafe_id and kind = 'percent' and redeemed_at is not null and created_at >= p_from and created_at < p_to
    ),
    'prizes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'segment_id', s.id, 'label', s.label, 'kind', s.kind, 'max_claims', s.max_claims, 'claims_used', s.claims_used,
        'remaining', case when s.max_claims is null then null else greatest(0, s.max_claims - s.claims_used) end,
        'status', case
          when s.kind = 'none' then 'n/a'
          when s.max_claims is null then 'unlimited'
          when s.claims_used >= s.max_claims then 'sold_out'
          when s.max_claims - s.claims_used <= greatest(1, s.max_claims / 10) then 'low_stock'
          else 'available' end
      ) order by s.sort)
      from spin_segments s join spin_wheels w on w.id = s.wheel_id where w.cafe_id = p_cafe_id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;

revoke execute on function spin_wheel_analytics(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function spin_wheel_analytics(uuid, timestamptz, timestamptz) to authenticated;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_proc where proname = 'save_spin_wheel') <> 1 then
    raise exception 'save_spin_wheel: expected exactly one overload';
  end if;
  if (select count(*) from pg_proc where proname = 'spin_the_wheel') <> 1 then
    raise exception 'spin_the_wheel: expected exactly one overload';
  end if;
  if (select count(*) from pg_proc where proname = 'spin_wheel_analytics') <> 1 then
    raise exception 'spin_wheel_analytics: expected exactly one overload';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'spin_segments' and column_name in ('max_claims', 'claims_used', 'expiry_days')
    having count(*) = 3
  ) then
    raise exception 'spin_segments is missing one of the new columns';
  end if;
end $$;
