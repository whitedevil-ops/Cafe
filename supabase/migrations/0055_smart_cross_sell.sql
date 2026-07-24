-- ============================================================================
-- 0055 — Smart cross-sell recommendation engine.
--
-- Deterministic, database-driven, near-instant. NO external AI on any order.
-- Works from day one on owner rules + category relationships; ranking improves
-- as real sales accrue (precomputed pair stats, refreshed periodically — never
-- a full-history scan per Add-to-Cart).
--
-- CROSS-SELL only (separate menu items — Coke with a Pizza). Item modifiers
-- (extra cheese) stay in menu_item_addons and are untouched.
--
-- Security follows the hardened model: every table is member-read; all writes
-- go through owner/manager (or logging) RPCs — no direct CRUD grants.
--
-- Ranking priority (spec §12):
--   owner-pinned item rule  > item rule > sales pairing > category rule > popularity
-- Contribution (price − cost) is a SECONDARY tiebreak only, never a driver.
-- ============================================================================

alter table cafes add column if not exists recommendations_enabled boolean not null default true;

-- ── Owner item→item rules ──────────────────────────────────────────────────
create table if not exists menu_pairings (
  id                uuid primary key default gen_random_uuid(),
  cafe_id           uuid not null references cafes(id) on delete cascade,
  item_id           uuid not null references menu_items(id) on delete cascade,
  suggested_item_id uuid not null references menu_items(id) on delete cascade,
  sort              integer not null default 0,
  pinned            boolean not null default true,
  created_at        timestamptz not null default now(),
  unique (item_id, suggested_item_id),
  check (item_id <> suggested_item_id)
);
create index if not exists menu_pairings_lookup on menu_pairings (cafe_id, item_id);
alter table menu_pairings enable row level security;
drop policy if exists "member read" on menu_pairings;
create policy "member read" on menu_pairings for select using (is_cafe_member(cafe_id));
revoke insert, update, delete on menu_pairings from anon, authenticated;

-- ── Owner category→category rules (cold-start, no per-item config) ──────────
create table if not exists category_pairings (
  id                    uuid primary key default gen_random_uuid(),
  cafe_id               uuid not null references cafes(id) on delete cascade,
  category_id           uuid not null references menu_categories(id) on delete cascade,
  suggested_category_id uuid not null references menu_categories(id) on delete cascade,
  sort                  integer not null default 0,
  unique (category_id, suggested_category_id),
  check (category_id <> suggested_category_id)
);
create index if not exists category_pairings_lookup on category_pairings (cafe_id, category_id);
alter table category_pairings enable row level security;
drop policy if exists "member read" on category_pairings;
create policy "member read" on category_pairings for select using (is_cafe_member(cafe_id));
revoke insert, update, delete on category_pairings from anon, authenticated;

-- ── Precomputed co-occurrence (refreshed periodically, not per-order) ───────
create table if not exists order_pair_stats (
  cafe_id        uuid not null references cafes(id) on delete cascade,
  item_id        uuid not null references menu_items(id) on delete cascade,
  paired_item_id uuid not null references menu_items(id) on delete cascade,
  times          integer not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (item_id, paired_item_id)
);
create index if not exists order_pair_stats_lookup on order_pair_stats (cafe_id, item_id);
alter table order_pair_stats enable row level security;
drop policy if exists "member read" on order_pair_stats;
create policy "member read" on order_pair_stats for select using (is_cafe_member(cafe_id));
revoke insert, update, delete on order_pair_stats from anon, authenticated;

-- ── Analytics events (append-only via RPC) ──────────────────────────────────
create table if not exists recommendation_events (
  id                uuid primary key default gen_random_uuid(),
  cafe_id           uuid not null references cafes(id) on delete cascade,
  suggested_item_id uuid references menu_items(id) on delete set null,
  kind              text not null check (kind in ('impression', 'add')),
  source            text,
  created_at        timestamptz not null default now()
);
create index if not exists recommendation_events_idx on recommendation_events (cafe_id, created_at);
alter table recommendation_events enable row level security;
drop policy if exists "member read" on recommendation_events;
create policy "member read" on recommendation_events for select using (is_cafe_member(cafe_id));
revoke insert, update, delete on recommendation_events from anon, authenticated;

-- ── THE RESOLVER — anon (QR) + staff (POS), fast, ranked, filtered ─────────
create or replace function get_recommendations(p_cafe_id uuid, p_item_ids uuid[], p_limit integer default 4)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_enabled boolean; v_status text; v_result jsonb; v_ids uuid[];
begin
  v_ids := coalesce(p_item_ids, array[]::uuid[]);
  select recommendations_enabled, status into v_enabled, v_status from cafes where id = p_cafe_id;
  if not coalesce(v_enabled, false) or coalesce(v_status, 'active') <> 'active' then
    return '[]'::jsonb;
  end if;

  with cart as (select unnest(v_ids) as item_id),
  cart_cats as (
    select distinct mi.category_id
    from menu_items mi join cart c on c.item_id = mi.id
    where mi.category_id is not null
  ),
  candidates as (
    select p.suggested_item_id as id, 5 as tier, 'Chef''s pick' as reason
      from menu_pairings p join cart c on c.item_id = p.item_id
     where p.cafe_id = p_cafe_id and p.pinned
    union all
    select p.suggested_item_id, 4, 'Goes well together'
      from menu_pairings p join cart c on c.item_id = p.item_id
     where p.cafe_id = p_cafe_id and not p.pinned
    union all
    select s.paired_item_id, 3, 'Often ordered together'
      from order_pair_stats s join cart c on c.item_id = s.item_id
     where s.cafe_id = p_cafe_id and s.times > 0
    union all
    select mi.id, 2, 'Great with this'
      from category_pairings cp
      join cart_cats cc on cc.category_id = cp.category_id
      join menu_items mi on mi.category_id = cp.suggested_category_id and mi.cafe_id = p_cafe_id
     where cp.cafe_id = p_cafe_id
    union all
    select pop.menu_item_id, 1, 'Popular here'
      from public_popular_items(p_cafe_id, 8) pop
  ),
  filtered as (
    select cand.id, max(cand.tier) as tier,
           (array_agg(cand.reason order by cand.tier desc))[1] as reason
      from candidates cand
      join menu_items mi on mi.id = cand.id
     where mi.cafe_id = p_cafe_id
       and mi.available = true and mi.archived = false
       and not (cand.id = any(v_ids))     -- never re-suggest something already in the cart
     group by cand.id
  ),
  ranked as (
    select f.id, mi.name, mi.price, f.reason,
           row_number() over (
             order by f.tier desc,
                      greatest(0, mi.price - coalesce(mi.cost, 0)) desc,  -- contribution tiebreak
                      mi.price asc
           ) as rn
      from filtered f join menu_items mi on mi.id = f.id
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'price', price, 'reason', reason) order by rn), '[]'::jsonb)
    into v_result
    from ranked
   where rn <= greatest(1, least(coalesce(p_limit, 4), 6));

  return v_result;
end $$;
grant execute on function get_recommendations(uuid, uuid[], integer) to anon, authenticated;

-- ── Owner: set an item's pairings (replace-all) ─────────────────────────────
create or replace function set_item_pairings(p_cafe_id uuid, p_item_id uuid, p_suggestions jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s jsonb; v_sid uuid;
begin
  if not has_cafe_role(p_cafe_id, array['owner','manager']::member_role[]) then
    raise exception 'only an owner or manager can edit recommendations';
  end if;
  if not exists (select 1 from menu_items where id = p_item_id and cafe_id = p_cafe_id) then
    raise exception 'item not found';
  end if;

  delete from menu_pairings where cafe_id = p_cafe_id and item_id = p_item_id;

  for s in select * from jsonb_array_elements(coalesce(p_suggestions, '[]'::jsonb)) loop
    v_sid := nullif(s->>'suggested_item_id', '')::uuid;
    if v_sid is null or v_sid = p_item_id then continue; end if;
    if not exists (select 1 from menu_items where id = v_sid and cafe_id = p_cafe_id) then continue; end if;
    insert into menu_pairings (cafe_id, item_id, suggested_item_id, sort, pinned)
    values (p_cafe_id, p_item_id, v_sid, coalesce((s->>'sort')::int, 0), coalesce((s->>'pinned')::boolean, true))
    on conflict (item_id, suggested_item_id) do update set sort = excluded.sort, pinned = excluded.pinned;
  end loop;

  return jsonb_build_object('ok', true);
end $$;
revoke execute on function set_item_pairings(uuid, uuid, jsonb) from public, anon;
grant execute on function set_item_pairings(uuid, uuid, jsonb) to authenticated;

-- ── Owner: set a category's complementary categories (replace-all) ──────────
create or replace function set_category_pairings(p_cafe_id uuid, p_category_id uuid, p_suggested uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cid uuid; i integer := 0;
begin
  if not has_cafe_role(p_cafe_id, array['owner','manager']::member_role[]) then
    raise exception 'only an owner or manager can edit recommendations';
  end if;
  if not exists (select 1 from menu_categories where id = p_category_id and cafe_id = p_cafe_id) then
    raise exception 'category not found';
  end if;

  delete from category_pairings where cafe_id = p_cafe_id and category_id = p_category_id;

  foreach v_cid in array coalesce(p_suggested, array[]::uuid[]) loop
    if v_cid = p_category_id then continue; end if;
    if not exists (select 1 from menu_categories where id = v_cid and cafe_id = p_cafe_id) then continue; end if;
    insert into category_pairings (cafe_id, category_id, suggested_category_id, sort)
    values (p_cafe_id, p_category_id, v_cid, i)
    on conflict (category_id, suggested_category_id) do update set sort = excluded.sort;
    i := i + 1;
  end loop;

  return jsonb_build_object('ok', true);
end $$;
revoke execute on function set_category_pairings(uuid, uuid, uuid[]) from public, anon;
grant execute on function set_category_pairings(uuid, uuid, uuid[]) to authenticated;

-- ── Refresh precomputed pair stats (periodic — owner/manager or a cron) ─────
create or replace function refresh_order_pairings(p_cafe_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not has_cafe_role(p_cafe_id, array['owner','manager']::member_role[]) then
    raise exception 'only an owner or manager can refresh recommendation stats';
  end if;

  delete from order_pair_stats where cafe_id = p_cafe_id;

  insert into order_pair_stats (cafe_id, item_id, paired_item_id, times)
  select p_cafe_id, a.menu_item_id, b.menu_item_id, count(*)::int
    from order_items a
    join order_items b on a.order_id = b.order_id and a.menu_item_id <> b.menu_item_id
    join orders o on o.id = a.order_id
   where o.cafe_id = p_cafe_id and o.status <> 'cancelled'
     and a.menu_item_id is not null and b.menu_item_id is not null
   group by a.menu_item_id, b.menu_item_id
   having count(*) >= 2;   -- ignore one-off coincidences (spec §9: not stupid suggestions)

  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function refresh_order_pairings(uuid) from public, anon;
grant execute on function refresh_order_pairings(uuid) to authenticated;

-- ── Log an impression / add (fire-and-forget, never blocks ordering) ────────
create or replace function log_recommendation_event(p_cafe_id uuid, p_suggested_item_id uuid, p_kind text, p_source text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_kind not in ('impression', 'add') then return; end if;
  if not exists (select 1 from menu_items where id = p_suggested_item_id and cafe_id = p_cafe_id) then return; end if;
  insert into recommendation_events (cafe_id, suggested_item_id, kind, source)
  values (p_cafe_id, p_suggested_item_id, p_kind, nullif(trim(coalesce(p_source, '')), ''));
end $$;
grant execute on function log_recommendation_event(uuid, uuid, text, text) to anon, authenticated;

-- ── Owner analytics: did recommendations work? ──────────────────────────────
create or replace function recommendation_report(p_cafe_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not has_cafe_role(p_cafe_id, array['owner','manager']::member_role[]) then
    raise exception 'not authorized';
  end if;

  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(row_to_json(x) order by x.added desc)
      from (
        select mi.name,
               count(*) filter (where e.kind = 'impression') as shown,
               count(*) filter (where e.kind = 'add') as added,
               case when count(*) filter (where e.kind = 'impression') > 0
                    then round(count(*) filter (where e.kind = 'add') * 100.0 / count(*) filter (where e.kind = 'impression'), 1)
                    else 0 end as conversion,
               count(*) filter (where e.kind = 'add') * mi.price as added_sales
          from recommendation_events e
          join menu_items mi on mi.id = e.suggested_item_id
         where e.cafe_id = p_cafe_id and e.created_at >= p_from and e.created_at < p_to
         group by mi.id, mi.name, mi.price
      ) x), '[]'::jsonb),
    'top_pairings', coalesce((
      select jsonb_agg(jsonb_build_object('a', a.name, 'b', b.name, 'times', s.times) order by s.times desc)
      from (
        select item_id, paired_item_id, times from order_pair_stats
        where cafe_id = p_cafe_id and item_id < paired_item_id
        order by times desc limit 8
      ) s join menu_items a on a.id = s.item_id join menu_items b on b.id = s.paired_item_id), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;
revoke execute on function recommendation_report(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function recommendation_report(uuid, timestamptz, timestamptz) to authenticated;
