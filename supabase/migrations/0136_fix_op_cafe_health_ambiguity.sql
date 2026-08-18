-- ============================================================================
-- 0136 — /ops/health has been broken since 0079: "column reference cafe_id is
--        ambiguous". Re-applies the fix 0022 already made and 0079 undid.
--
-- WHAT HAPPENED
-- op_cafe_health() declares OUT parameters named cafe_id and status. Inside a
-- plpgsql function those names are in scope as variables, so a bare `cafe_id`
-- or `status` in the body is ambiguous — Postgres cannot tell the column from
-- the OUT parameter and refuses at runtime, not at create time. That is why
-- `create or replace function` reported success and the page failed anyway.
--
-- 0022 fixed exactly this by aliasing the subqueries (o2., s.). 0079 then
-- redefined the whole function to swap its guard from is_platform_admin() to
-- has_platform_permission('health.view') — and rebuilt the body from the
-- PRE-0022 copy, silently reverting the aliases:
--
--   0079:366  left join (select cafe_id, max(created_at) … from orders
--                        where status <> 'cancelled' group by cafe_id) lo …
--
-- Both `cafe_id` and `status` there are bare. This restores 0022's aliasing
-- and keeps 0079's permission model, which is the combination that was never
-- actually written down anywhere.
--
-- Checked while here: 0022 fixed two functions, op_cafe_health and
-- compute_bill. Only op_cafe_health was redefined by 0079 — compute_bill still
-- carries its aliases, so this is the whole regression, not a sample of it.
--
-- Nothing else changes: same signature, same columns, same ordering, same
-- guard. Purely the aliases.
-- ============================================================================

create or replace function op_cafe_health()
returns table (
  cafe_id uuid, name text, status text,
  days_since_last_order integer, onboarding_percent integer,
  failed_sms_count bigint, days_until_expiry integer
)
language plpgsql stable security definer set search_path = public as $$
begin
  -- 0079's permission model, deliberately kept.
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
  -- The aliases are the fix. A bare `cafe_id` or `status` inside these
  -- subqueries resolves against this function's OUT parameters, not the
  -- table — which is the ambiguity error. Do not "tidy" them away.
  left join (
    select o2.cafe_id, max(o2.created_at) as last_order
    from orders o2 where o2.status <> 'cancelled' group by o2.cafe_id
  ) lo on lo.cafe_id = c.id
  left join (
    select s.cafe_id, count(*) as failed_count
    from sms_logs s where s.status = 'failed' group by s.cafe_id
  ) sms on sms.cafe_id = c.id
  where c.status <> 'archived'
  order by c.name;
end $$;

revoke execute on function op_cafe_health() from public, anon;
grant execute on function op_cafe_health() to authenticated;

-- Prove it actually runs. `create or replace` succeeding proves nothing here —
-- the ambiguity is a RUNTIME resolution failure, which is precisely how this
-- shipped broken twice. Executing the function is the only real check; a
-- permission refusal still counts as "resolved fine", since that error is
-- raised before any of the ambiguous SQL is reached.
do $$
declare v_count integer;
begin
  begin
    select count(*) into v_count from op_cafe_health();
  exception
    when insufficient_privilege then return;
    when others then
      if sqlerrm like '%not authorized%' then return; end if;
      raise exception 'op_cafe_health() still fails at runtime: %', sqlerrm;
  end;
end $$;
