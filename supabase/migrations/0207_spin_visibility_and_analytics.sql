-- ============================================================================
-- 0207 — Spin & Win: put back the analytics function 0191 never delivered, and
-- stop the guest wheel from lying about what it is showing.
--
-- Found by auditing the whole flow after a café reported that Spin & Win
-- "sometimes" does not appear. Four separate things, all verified against the
-- live database rather than inferred from the migration files:
--
--   1. spin_wheel_analytics DOES NOT EXIST in production. It was written in
--      0191, which was never applied; 0206 recovered 0191's three columns and
--      said so in its own header ("So: only the columns"), but not this. The
--      owner's Spin page calls it on every load, discards the error, and
--      renders a permanently blank analytics panel — no spins, no prizes, no
--      redemption rate — with nothing on screen to say why. Confirmed live:
--      POST /rpc/spin_wheel_analytics -> 404 PGRST202.
--
--   2. The dial shows prizes that cannot be won. spin_the_wheel excludes
--      sold-out slices from the draw pool, get_spin_wheel does not exclude
--      them from the picture. When the last unit of a limited prize goes, the
--      server returns segment_id null and the client — which maps an unknown
--      segment id to index 0 — lands the pointer on whatever sits at sort 0.
--      A guest can watch the wheel stop on "Free Cappuccino" and read "Better
--      luck next time" underneath it.
--
--   3. A lapsed code still reads as claimable. The result payload carries
--      expires_at but no expired flag, and the client only checks that the
--      date exists, so a guest is told to bring a dead code to the counter and
--      finds out in front of staff who cannot override it. find_spin_prize
--      has computed exactly this boolean since 0125 — the two readers of the
--      same row simply disagreed.
--
--   4. Refunded and cancelled orders were told "your spin unlocks the moment
--      this order is marked paid". They are never going to be marked paid.
--
-- Deliberately NOT changed: the three branches that return a payload with no
-- 'title' key (unknown token, no entitlement, no active wheel). A café that
-- does not run a wheel should show a guest nothing, and quoting plan names at
-- a customer would be worse than silence. The owner is not kept in the dark by
-- those — /dashboard/spin gates on the same entitlement and says so plainly.
-- ============================================================================

-- ── 1. spin_wheel_analytics, taken from 0191 unchanged ─────────────────────
-- Its three column dependencies (max_claims, claims_used, expiry_days) are
-- present since 0206, so this is a straight restore, not a rewrite.
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

-- ── 2. get_spin_wheel: show the guest the wheel the server will actually spin
-- Body is 0204's, with four changes and nothing else touched:
--   · segments are filtered to the same pool spin_the_wheel draws from
--   · a new 'sold_out' reason for when that pool is empty
--   · result carries 'expired'
--   · refunded and cancelled orders get their own reasons instead of 'unpaid'
create or replace function get_spin_wheel(p_receipt_token uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_order    orders%rowtype;
  v_wheel    spin_wheels%rowtype;
  v_result   spin_results%rowtype;
  v_below    boolean;
  v_pool     integer;
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

  -- The same predicate spin_the_wheel uses to build its draw pool (0204:206).
  -- If this is zero there is nothing left to win, and the honest thing is to
  -- say so rather than offer a spin that can only return "better luck".
  select coalesce(sum(weight), 0) into v_pool
    from spin_segments
   where wheel_id = v_wheel.id and (max_claims is null or claims_used < max_claims);

  return jsonb_build_object(
    'available',
      v_order.payment_status = 'paid'
      and v_order.status <> 'cancelled'
      and v_result.id is null
      and not v_below
      and v_pool > 0,
    'title', v_wheel.title,
    'subtitle', v_wheel.subtitle,
    'min_order_amount', v_wheel.min_order_amount,
    'order_total', v_order.total,
    'enable_confetti', v_wheel.enable_confetti,
    'enable_sound', v_wheel.enable_sound,
    -- Order matters: an existing result outranks everything, because the
    -- guest should be shown the prize they already have rather than a reason
    -- they cannot spin again.
    'reason', case
      when v_result.id is not null then 'spun'
      when v_order.status = 'cancelled' then 'cancelled'
      when v_order.payment_status = 'refunded' then 'refunded'
      when v_order.payment_status <> 'paid' then 'unpaid'
      when v_below then 'below_minimum'
      when v_pool <= 0 then 'sold_out'
      else null end,
    'segments', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'label', s.label, 'kind', s.kind, 'color', s.color) order by s.sort)
      from spin_segments s
      where s.wheel_id = v_wheel.id and (s.max_claims is null or s.claims_used < s.max_claims)
    ), '[]'::jsonb),
    'result', case when v_result.id is null then null else jsonb_build_object(
      'segment_id', v_result.segment_id, 'label', v_result.label, 'kind', v_result.kind,
      'value', v_result.value, 'code', v_result.code,
      'expires_at', v_result.expires_at,
      -- Computed exactly as find_spin_prize has since 0125:303, so the guest's
      -- receipt and the till agree about whether a code is still good.
      'expired', v_result.expires_at is not null and v_result.expires_at < now(),
      'redeemed', v_result.redeemed_at is not null
    ) end
  );
end $$;

revoke execute on function get_spin_wheel(uuid) from public;
grant execute on function get_spin_wheel(uuid) to anon, authenticated;

-- ── 3. Two surgical edits to functions too large to safely restate ─────────
-- Rewriting one statement inside the live definition, rather than pasting a
-- fresh copy of a 100-line body that other migrations have also edited. Same
-- technique 0203 used, for the same reason: a full restatement silently
-- reverts anything applied since, and this schema has already been bitten by
-- that once (0191).
do $$
declare
  v_src text;
  v_new text;
begin
  -- (a) spin_the_wheel's sold-out fallback minted its code in one shot, with
  -- no collision check and a hex alphabet, while every other code path in the
  -- same function retries against the unique index using the deliberately
  -- unambiguous alphabet. A café with everything sold out serves that path to
  -- every paying guest, so the collision it cannot detect is the one it will
  -- eventually hit — surfacing as a raw unique_violation in the guest's face.
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'spin_the_wheel';

  if v_src is null then raise exception 'spin_the_wheel not found'; end if;

  if position('encode(gen_random_bytes(4)' in v_src) > 0 then
    v_new := replace(
      v_src,
      '    v_code := ''W'' || upper(substr(encode(gen_random_bytes(4), ''hex''), 1, 5));',
      '    for v_try in 1..8 loop' || chr(10) ||
      '      v_code := ''W'';' || chr(10) ||
      '      for v_i in 1..5 loop' || chr(10) ||
      '        v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::integer, 1);' || chr(10) ||
      '      end loop;' || chr(10) ||
      '      exit when not exists (select 1 from spin_results where cafe_id = v_order.cafe_id and code = v_code);' || chr(10) ||
      '    end loop;'
    );
    if v_new = v_src then
      raise exception 'spin_the_wheel: fallback code line did not match — not rewriting blind';
    end if;
    execute v_new;
  end if;

  -- (b) save_spin_wheel raises '% already has %s claims'. In plpgsql RAISE,
  -- '%' is the only placeholder, so the trailing 's' is literal text and the
  -- owner reads "already has 3s claims" at exactly the moment they are already
  -- confused about why their edit was rejected.
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_spin_wheel';

  if v_src is null then raise exception 'save_spin_wheel not found'; end if;

  if position('%s claims' in v_src) > 0 then
    v_new := replace(v_src, '%s claims', '% claims');
    execute v_new;
  end if;
end $$;

-- ── self-check ─────────────────────────────────────────────────────────────
do $$
declare v_bad text;
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'spin_wheel_analytics') <> 1 then
    raise exception 'spin_wheel_analytics: expected exactly one overload';
  end if;

  -- The whole point of this migration's first section: the dashboard calls it
  -- with these three argument types and got a 404 before today.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'spin_wheel_analytics'
       and pg_get_function_identity_arguments(p.oid) = 'p_cafe_id uuid, p_from timestamp with time zone, p_to timestamp with time zone'
  ) then
    raise exception 'spin_wheel_analytics exists but not with the signature the dashboard calls';
  end if;

  -- get_spin_wheel must still gate on the guest-safe entitlement read. If a
  -- later edit reverts that to cafe_has_feature, every guest silently loses
  -- the wheel, because cafe_has_feature fails closed for non-members.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'get_spin_wheel'
       and p.prosrc like '%cafe_feature_for_guest%'
  ) then
    raise exception 'get_spin_wheel no longer uses cafe_feature_for_guest';
  end if;

  -- And it must now filter the dial to the drawable pool, or the pointer lands
  -- on prizes that cannot be won.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'get_spin_wheel'
       and p.prosrc like '%s.claims_used < s.max_claims%'
  ) then
    raise exception 'get_spin_wheel is not filtering sold-out segments';
  end if;

  -- 0204's entitlement gate on spin_the_wheel must survive the rewrite above.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('spin_the_wheel', 'save_spin_wheel')
     and p.prosrc not like '%''spin''%';
  if v_bad is not null then
    raise exception 'the spin entitlement check was lost from: %', v_bad;
  end if;

  -- position() rather than LIKE: the needle itself contains '%', which LIKE
  -- would read as a wildcard and quietly match anything.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'save_spin_wheel'
       and position('%s claims' in p.prosrc) > 0
  ) then
    raise exception 'save_spin_wheel still has the literal-s claim message';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'spin_the_wheel'
       and position('encode(gen_random_bytes(4)' in p.prosrc) > 0
  ) then
    raise exception 'spin_the_wheel still mints its sold-out code without a collision check';
  end if;
end $$;
