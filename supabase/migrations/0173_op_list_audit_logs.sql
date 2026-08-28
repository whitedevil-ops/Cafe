-- ============================================================================
-- Phase 3 — /ops/audit-logs gets search/filter (date range, action, target
-- type, actor) via a purpose-built RPC, matching op_list_cafes (0169) /
-- op_list_users (0170)'s shape rather than a client-chained .eq()/.ilike()
-- select -- every other filterable ops list already works this way, and
-- searching by actor/target NAME needs a join the raw table doesn't have
-- (actor_id/target_id are bare uuids). RLS on platform_audit_logs already
-- safely gates a raw select (has_platform_permission('audit.view'),
-- tightened in 0163) -- this isn't a safety fix, it's a capability one.
--
-- Pagination: 81 rows in production today across 5 weeks. True offset
-- paging is the same "speculative complexity" op_list_cafes's own migration
-- comment (0169) declined at café-count scale -- this follows that
-- precedent with a p_limit ceiling (default 200, capped 500), not page-N
-- navigation.
-- ============================================================================

create function op_list_audit_logs(
  p_search      text default null,
  p_action      text default null,
  p_target_type text default null,
  p_actor_id    uuid default null,
  p_from        timestamptz default null,
  p_to          timestamptz default null,
  p_limit       integer default 200
)
returns table (
  id             uuid,
  actor_id       uuid,
  actor_name     text,
  action         text,
  target_type    text,
  target_id      uuid,
  target_name    text,
  previous_value jsonb,
  new_value      jsonb,
  created_at     timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  -- Required, not redundant: SECURITY DEFINER bypasses RLS on the tables it
  -- touches internally -- this check is now the only enforcement for this
  -- query, since it no longer runs under the caller's own RLS-gated session.
  if not has_platform_permission('audit.view') then raise exception 'not authorized'; end if;

  return query
  select
    a.id, a.actor_id, p.full_name as actor_name, a.action, a.target_type, a.target_id,
    coalesce(c.name, pa.full_name) as target_name,
    a.previous_value, a.new_value, a.created_at
  from platform_audit_logs a
  left join profiles p on p.id = a.actor_id
  left join cafes c on a.target_type = 'cafe' and c.id = a.target_id
  left join platform_admins pa on a.target_type = 'admin' and pa.id = a.target_id
  where (p_action is null or a.action = p_action)
    and (p_target_type is null or a.target_type = p_target_type)
    and (p_actor_id is null or a.actor_id = p_actor_id)
    and (p_from is null or a.created_at >= p_from)
    and (p_to is null or a.created_at <= p_to)
    and (
      p_search is null or p_search = '' or
      a.action ilike '%' || p_search || '%' or
      a.id::text = p_search or
      a.actor_id::text = p_search or
      a.target_id::text = p_search or
      p.full_name ilike '%' || p_search || '%' or
      c.name ilike '%' || p_search || '%' or
      pa.full_name ilike '%' || p_search || '%'
    )
  order by a.created_at desc
  limit greatest(1, least(coalesce(p_limit, 200), 500));
end $$;

revoke execute on function op_list_audit_logs(text, text, text, uuid, timestamptz, timestamptz, integer) from public, anon;
grant execute on function op_list_audit_logs(text, text, text, uuid, timestamptz, timestamptz, integer) to authenticated;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_proc where proname = 'op_list_audit_logs') <> 1 then
    raise exception 'op_list_audit_logs: expected exactly one overload';
  end if;
  if exists (
    select 1 from information_schema.routine_privileges
    where routine_name = 'op_list_audit_logs' and grantee in ('anon', 'PUBLIC')
  ) then
    raise exception 'op_list_audit_logs must not be callable by anon/public';
  end if;
end $$;
