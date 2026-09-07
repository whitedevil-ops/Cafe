-- ============================================================================
-- 0225 — op_list_users returns one row per (user, café membership) instead
-- of one row per user with a flattened `cafe_names` string.
--
-- The Ops Users page is switching from a flat "most recently active" table
-- to one grouped by café (café name as a heading, its users listed under
-- it). A comma-joined string has no café id to link a heading to
-- /ops/cafes/[id] and is fundamentally the wrong shape to group by client-
-- side (splitting on ", " would mis-parse any café name that happens to
-- contain that substring). Returning a real row per membership — with
-- cafe_id/cafe_name nullable for a user in zero cafés — lets the client
-- group with Map<cafe_id, ...> instead of string surgery.
--
-- p_search/p_has_cafe/p_limit keep their exact existing meaning and are
-- still applied per USER, in a CTE, before the explode into per-café rows —
-- p_limit=200 means 200 users, not 200 rows, same as before. Same
-- drop-then-create requirement 0170 hit: changing the RETURNS TABLE column
-- list is not something CREATE OR REPLACE allows.
-- ============================================================================

drop function if exists op_list_users(text, integer, boolean);

create function op_list_users(
  p_search   text default null,
  p_limit    integer default 200,
  p_has_cafe boolean default null
)
returns table (
  id              uuid,
  full_name       text,
  email           text,
  phone           text,
  created_at      timestamptz,
  last_sign_in_at timestamptz,
  last_seen_at    timestamptz,
  last_device     text,
  orders_count    bigint,
  cafe_id         uuid,
  cafe_name       text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_platform_permission('users.view') then raise exception 'not authorized'; end if;

  return query
  with matched as (
    select
      p.id, p.full_name, coalesce(p.email, u.email::text) as email, p.phone,
      p.created_at, u.last_sign_in_at, p.last_seen_at, p.last_device,
      coalesce(o.orders_count, 0) as orders_count
    from profiles p
    left join auth.users u on u.id = p.id
    left join lateral (
      select count(*) as orders_count from orders ord where ord.staff_id = p.id
    ) o on true
    where (
        p_search is null
        or p.full_name ilike '%' || p_search || '%'
        or coalesce(p.email, u.email::text) ilike '%' || p_search || '%'
        or p.phone ilike '%' || p_search || '%'
        or p.id::text = p_search
      )
      and (p_has_cafe is null or exists (select 1 from cafe_members cm where cm.user_id = p.id) = p_has_cafe)
    order by coalesce(p.last_seen_at, u.last_sign_in_at, p.created_at) desc
    limit greatest(1, least(coalesce(p_limit, 200), 500))
  )
  select
    m.id, m.full_name, m.email, m.phone, m.created_at, m.last_sign_in_at, m.last_seen_at, m.last_device,
    m.orders_count, c.id as cafe_id, c.name as cafe_name
  from matched m
  left join cafe_members cm on cm.user_id = m.id
  left join cafes c on c.id = cm.cafe_id
  order by coalesce(m.last_seen_at, m.last_sign_in_at, m.created_at) desc, c.name;
end;
$$;

revoke all on function op_list_users(text, integer, boolean) from public;
grant execute on function op_list_users(text, integer, boolean) to authenticated;
revoke execute on function op_list_users(text, integer, boolean) from anon;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
declare v_result text;
begin
  if (select count(*) from pg_proc where proname = 'op_list_users') <> 1 then
    raise exception 'op_list_users: expected exactly one overload';
  end if;
  if exists (
    select 1 from information_schema.routine_privileges
    where routine_name = 'op_list_users' and grantee in ('anon', 'PUBLIC')
  ) then
    raise exception 'op_list_users must not be callable by anon/public';
  end if;

  select pg_get_function_result('op_list_users(text, integer, boolean)'::regprocedure) into v_result;
  if v_result not ilike '%cafe_id uuid%' or v_result not ilike '%cafe_name text%' then
    raise exception 'op_list_users does not return cafe_id/cafe_name per row';
  end if;
  if v_result ilike '%cafe_count%' or v_result ilike '%cafe_names%' then
    raise exception 'op_list_users still returns the old flattened cafe_count/cafe_names shape';
  end if;
end $$;
