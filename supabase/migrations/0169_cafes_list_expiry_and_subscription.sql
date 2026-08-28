-- ============================================================================
-- Phase 2 — /ops/cafes gets two real additions to op_list_cafes:
--
-- 1. subscription_ends_at joins RETURNS TABLE. Already computed/read by
--    op_get_cafe_detail, op_change_plan, op_extend_subscription and
--    op_cafe_health -- op_list_cafes was simply never given it.
--
-- 2. p_expiring_within_days filters on it, using the EXACT "between now()
--    and now() + N days" semantics op_platform_overview already uses for
--    its expiring_7/15/30 stat tiles -- so a café that shows up in the /ops
--    overview's "expiring within 7 days" figure is the same café this
--    filter surfaces, not a subtly different definition. Already-expired
--    cafés (ends_at < now()) are intentionally excluded, matching that same
--    precedent -- they show up via p_status=suspended instead.
--
-- Deliberately NOT added here: server-side sort or pagination. At today's
-- scale (single digits of cafés) sorting the already-fetched array
-- client-side is free and pagination is speculative complexity -- op_list_
-- users' p_limit-with-no-offset shape is the proven low-cost first step
-- already living in this codebase if/when this needs it.
--
-- Widening a RETURNS TABLE via CREATE OR REPLACE hits Postgres error 42P13
-- (0094 hit this exact error adding owner_id) -- the old signature is
-- dropped first, same as 0094 did.
-- ============================================================================

drop function if exists op_list_cafes(text, text, boolean, text, timestamptz, timestamptz);

create function op_list_cafes(
  p_search  text default null,
  p_status  text default null,
  p_verified boolean default null,
  p_plan    text default null,
  p_from    timestamptz default null,
  p_to      timestamptz default null,
  p_expiring_within_days integer default null
) returns table (
  cafe_id uuid, name text, city text, phone text, plan text, verified boolean,
  status text, created_at timestamptz, owner_id uuid, owner_name text, owner_email text, owner_phone text,
  staff_count bigint, orders_count bigint, last_order_at timestamptz,
  menu_items_count bigint, tables_count bigint, customers_count bigint,
  subscription_ends_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_platform_permission('cafes.view') then raise exception 'not authorized'; end if;
  if p_expiring_within_days is not null and p_expiring_within_days < 0 then
    raise exception 'p_expiring_within_days must be non-negative';
  end if;

  return query
  select
    c.id, c.name, c.city, c.phone, c.plan, c.verified, c.status, c.created_at,
    p.id, p.full_name, p.email, p.phone,
    (select count(*) from cafe_members cm where cm.cafe_id = c.id and cm.status = 'active'),
    (select count(*) from orders o where o.cafe_id = c.id and o.status <> 'cancelled'),
    (select max(o.created_at) from orders o where o.cafe_id = c.id and o.status <> 'cancelled'),
    (select count(*) from menu_items mi where mi.cafe_id = c.id),
    (select count(*) from cafe_tables ct where ct.cafe_id = c.id),
    (select count(*) from customers cu where cu.cafe_id = c.id),
    c.subscription_ends_at
  from cafes c
  left join profiles p on p.id = c.owner_id
  where (p_status is null or c.status = p_status)
    and (p_verified is null or c.verified = p_verified)
    and (p_plan is null or c.plan = p_plan)
    and (p_from is null or c.created_at >= p_from)
    and (p_to is null or c.created_at <= p_to)
    and (
      p_expiring_within_days is null or
      c.subscription_ends_at between now() and now() + (p_expiring_within_days || ' days')::interval
    )
    and (
      p_search is null or p_search = '' or
      c.name ilike '%' || p_search || '%' or
      c.id::text = p_search or
      c.phone ilike '%' || p_search || '%' or
      p.full_name ilike '%' || p_search || '%' or
      p.email ilike '%' || p_search || '%'
    )
  order by c.created_at desc;
end $$;

revoke execute on function op_list_cafes(text, text, boolean, text, timestamptz, timestamptz, integer) from public, anon;
grant execute on function op_list_cafes(text, text, boolean, text, timestamptz, timestamptz, integer) to authenticated;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_proc where proname = 'op_list_cafes') <> 1 then
    raise exception 'op_list_cafes: expected exactly one overload';
  end if;
  if not exists (
    select 1 from pg_proc
    where proname = 'op_list_cafes'
      and pg_get_function_identity_arguments(oid) like '%p_expiring_within_days integer%'
  ) then
    raise exception 'op_list_cafes did not pick up p_expiring_within_days';
  end if;
  begin
    perform subscription_ends_at from op_list_cafes() limit 0;
  exception
    when insufficient_privilege then null;
    when others then
      if sqlerrm like '%not authorized%' then null; else raise; end if;
  end;
end $$;
