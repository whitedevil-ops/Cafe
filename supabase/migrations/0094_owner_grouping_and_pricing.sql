-- ============================================================================
-- 0094 — Two independent changes bundled together:
--
-- 1. op_list_cafes now returns owner_id, so the platform-admin café directory
--    can group cafés by owner (a single owner can run up to max_owned_cafes
--    locations) instead of listing every café as an unrelated flat row.
--    Grouping by owner_id rather than owner_name/owner_email in the client
--    avoids incorrectly merging two different owners who happen to share a
--    display name, or splitting one owner across rows if either field is
--    ever null.
--
-- 2. Scale plan's yearly price drops from ₹25,000 to ₹21,000 (owner's own
--    pricing-plan revision). Scale's renewal price is adjusted to ₹10,500 to
--    keep the same 50%-of-price_yearly renewal discount every other tier
--    already gets (Starter 10,000→5,000, Growth 18,000→9,000) — not
--    explicitly requested, so flagged for confirmation rather than left at
--    the old 12,500 (which would silently become a 59.5% renewal price).
-- ============================================================================

-- Adding owner_id widens the OUT-parameter row type, which CREATE OR REPLACE
-- refuses to do in-place (Postgres error 42P13) — the old signature has to
-- be dropped first.
drop function if exists op_list_cafes(text, text, boolean, text, timestamptz, timestamptz);

create function op_list_cafes(
  p_search  text default null,
  p_status  text default null,
  p_verified boolean default null,
  p_plan    text default null,
  p_from    timestamptz default null,
  p_to      timestamptz default null
) returns table (
  cafe_id uuid, name text, city text, phone text, plan text, verified boolean,
  status text, created_at timestamptz, owner_id uuid, owner_name text, owner_email text, owner_phone text,
  staff_count bigint, orders_count bigint, last_order_at timestamptz,
  menu_items_count bigint, tables_count bigint, customers_count bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_platform_permission('cafes.view') then raise exception 'not authorized'; end if;

  return query
  select
    c.id, c.name, c.city, c.phone, c.plan, c.verified, c.status, c.created_at,
    p.id, p.full_name, p.email, p.phone,
    (select count(*) from cafe_members cm where cm.cafe_id = c.id and cm.status = 'active'),
    (select count(*) from orders o where o.cafe_id = c.id and o.status <> 'cancelled'),
    (select max(o.created_at) from orders o where o.cafe_id = c.id and o.status <> 'cancelled'),
    (select count(*) from menu_items mi where mi.cafe_id = c.id),
    (select count(*) from cafe_tables ct where ct.cafe_id = c.id),
    (select count(*) from customers cu where cu.cafe_id = c.id)
  from cafes c
  left join profiles p on p.id = c.owner_id
  where (p_status is null or c.status = p_status)
    and (p_verified is null or c.verified = p_verified)
    and (p_plan is null or c.plan = p_plan)
    and (p_from is null or c.created_at >= p_from)
    and (p_to is null or c.created_at <= p_to)
    and (
      p_search is null or p_search = '' or
      c.name ilike '%' || p_search || '%' or
      c.id::text = p_search or
      c.phone ilike '%' || p_search || '%' or
      p.full_name ilike '%' || p_search || '%' or
      p.email ilike '%' || p_search || '%'
    )
  -- Unchanged recency order — the client groups by owner_id itself,
  -- preserving first-seen order, so each owner's group naturally lands at
  -- the position of their most-recently-created café without the RPC
  -- needing to sort by owner at all.
  order by c.created_at desc;
end $$;

revoke execute on function op_list_cafes(text, text, boolean, text, timestamptz, timestamptz) from public, anon;
grant execute on function op_list_cafes(text, text, boolean, text, timestamptz, timestamptz) to authenticated;

update platform_plans set price_yearly = 21000, renewal_price_yearly = 10500 where key = 'business';
