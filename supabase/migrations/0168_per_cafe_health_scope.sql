-- ============================================================================
-- Phase 2 — per-café health verdict on the café detail page.
--
-- op_cafe_health() (0079, re-bodied 0136 for an OUT-parameter ambiguity fix)
-- already computes every signal a per-café health widget needs --
-- days_since_last_order, onboarding_percent, failed_sms_count,
-- days_until_expiry -- but has only ever been called platform-wide, from
-- app/ops/health/page.tsx (zero args). The café detail page (/ops/cafes/[id])
-- shows none of this today.
--
-- Adds a trailing p_cafe_id uuid default null, filtering to one café when
-- given. Follows this repo's established arity-bump convention (0043, 0146,
-- 0149) -- the old zero-arg signature is dropped FIRST so PostgREST never
-- sees two op_cafe_health overloads and returns PGRST203 ("could not choose
-- the best candidate function").
--
-- With p_cafe_id left null, every row op_cafe_health() previously returned
-- is still returned, in the same order -- /ops/health's existing no-arg call
-- is unaffected. The one deliberate behavior change: the `status <>
-- 'archived'` exclusion now only applies to the platform-wide (p_cafe_id is
-- null) case. A scoped lookup for one café always returns that café's row
-- even if archived -- the café detail page is a normal way to view an
-- archived café (STATUS_ACTIONS lets an operator re-Activate one from
-- there), and a silently-vanishing health widget on that exact page would be
-- worse than showing "Critical" data for an archived café.
-- ============================================================================

drop function if exists op_cafe_health();

create or replace function op_cafe_health(p_cafe_id uuid default null)
returns table (
  cafe_id uuid, name text, status text,
  days_since_last_order integer, onboarding_percent integer,
  failed_sms_count bigint, days_until_expiry integer
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_platform_permission('health.view') then raise exception 'not authorized'; end if;

  return query
  select
    c.id, c.name, c.status,
    (extract(day from now() - lo.last_order))::int as days_since_last_order,
    round((
      (o.account_created::int + o.profile_completed::int + o.menu_added::int + o.tables_created::int +
       o.qr_generated::int + o.staff_added::int + o.first_order_placed::int) * 100.0 / 7
    ))::int as onboarding_percent,
    coalesce(sms.failed_count, 0) as failed_sms_count,
    case when c.subscription_ends_at is null then null
         else (extract(day from c.subscription_ends_at - now()))::int end as days_until_expiry
  from cafes c
  left join v_cafe_onboarding o on o.cafe_id = c.id
  left join (
    select o2.cafe_id, max(o2.created_at) as last_order
    from orders o2 where o2.status <> 'cancelled' group by o2.cafe_id
  ) lo on lo.cafe_id = c.id
  left join (
    select s.cafe_id, count(*) as failed_count
    from sms_logs s where s.status = 'failed' group by s.cafe_id
  ) sms on sms.cafe_id = c.id
  where (p_cafe_id is not null or c.status <> 'archived')
    and (p_cafe_id is null or c.id = p_cafe_id)
  order by c.name;
end $$;

revoke execute on function op_cafe_health(uuid) from public, anon;
grant execute on function op_cafe_health(uuid) to authenticated;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
declare v_count integer;
begin
  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'op_cafe_health';
  if v_count = 0 then
    raise exception 'op_cafe_health is completely gone -- this would break /ops/health entirely';
  end if;
  if v_count > 1 then
    raise exception 'expected exactly one op_cafe_health after this migration, found % -- an orphaned overload is present', v_count;
  end if;
end $$;

do $$
declare v_count integer;
begin
  begin
    select count(*) into v_count from op_cafe_health();
  exception
    when insufficient_privilege then null;
    when others then
      if sqlerrm like '%not authorized%' then null;
      else raise exception 'op_cafe_health() still fails at runtime: %', sqlerrm; end if;
  end;
  begin
    select count(*) into v_count from op_cafe_health(gen_random_uuid());
  exception
    when insufficient_privilege then return;
    when others then
      if sqlerrm like '%not authorized%' then return; end if;
      raise exception 'op_cafe_health(uuid) still fails at runtime: %', sqlerrm;
  end;
end $$;
