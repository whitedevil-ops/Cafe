-- ============================================================================
-- Phase 2 — café-membership filter for the operator console's user list.
--
-- op_list_users already computes cafe_count (0128) but the console has no
-- way to filter on it. Cafés' operator list filters by status/verified/plan
-- -- literal columns on `cafes`. `profiles` has no equivalent platform-level
-- column (role is per-café, on cafe_members, not global), so there's no
-- honest 1:1 port of those three filters. The closest already-computed
-- analog is membership itself: does this user belong to at least one café,
-- or none.
--
-- Adding p_has_cafe changes the parameter LIST, giving this a different
-- signature from op_list_users(text, integer) -- CREATE OR REPLACE would
-- create a second overload rather than truly replacing it. Same class of
-- problem 0094 hit adding owner_id to op_list_cafes -- same fix: drop the
-- old signature first so there is exactly one op_list_users.
-- ============================================================================

drop function if exists op_list_users(text, integer);

create function op_list_users(
  p_search   text default null,
  p_limit    integer default 200,
  p_has_cafe boolean default null
)
returns table (
  id             uuid,
  full_name      text,
  email          text,
  phone          text,
  created_at     timestamptz,
  last_sign_in_at timestamptz,
  last_seen_at   timestamptz,
  last_device    text,
  cafe_count     bigint,
  cafe_names     text,
  orders_count   bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_platform_permission('users.view') then raise exception 'not authorized'; end if;

  return query
  select
    p.id,
    p.full_name,
    coalesce(p.email, u.email::text) as email,
    p.phone,
    p.created_at,
    u.last_sign_in_at,
    p.last_seen_at,
    p.last_device,
    coalesce(m.cafe_count, 0)   as cafe_count,
    m.cafe_names,
    coalesce(o.orders_count, 0) as orders_count
  from profiles p
  left join auth.users u on u.id = p.id
  left join lateral (
    select count(*) as cafe_count,
           string_agg(c.name, ', ' order by c.name) as cafe_names
      from cafe_members cm
      join cafes c on c.id = cm.cafe_id
     where cm.user_id = p.id
  ) m on true
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
    and (p_has_cafe is null or (coalesce(m.cafe_count, 0) > 0) = p_has_cafe)
  order by coalesce(p.last_seen_at, u.last_sign_in_at, p.created_at) desc
  limit greatest(1, least(coalesce(p_limit, 200), 500));
end;
$$;

revoke all on function op_list_users(text, integer, boolean) from public;
grant execute on function op_list_users(text, integer, boolean) to authenticated;
-- Same anon-default-privileges gap 0129 documented and closed for the
-- original signature -- the new signature needs its own explicit revoke.
revoke execute on function op_list_users(text, integer, boolean) from anon;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
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
end $$;
