-- ============================================================================
-- op_list_alerts() failed at runtime with "column reference cafe_id is
-- ambiguous" -- the same bug class op_cafe_health() had before 0136 fixed
-- it. op_list_alerts RETURNS TABLE(id, cafe_id, cafe_name, alert_type,
-- severity, message, detected_at, status, ...) -- Postgres creates an
-- implicit PL/pgSQL variable for every OUT column, in scope for the whole
-- function body. The upsert's `select cafe_id, alert_type, severity,
-- message, detected_at from v_live_alert_signals` used BARE column names
-- that collide with those OUT variables (cafe_id, alert_type, severity,
-- message all happen to also be real RETURNS TABLE column names) --
-- ambiguous between "the view's column" and "the function's own output
-- variable". Fixed by qualifying every reference to the view with its own
-- alias. Confirmed live: CREATE OR REPLACE succeeding proved nothing (same
-- lesson 0136's own postmortem already drew) -- this is a runtime
-- resolution failure, only caught by actually calling the function.
--
-- Rest of the body is byte-for-byte identical to 0172's definition.
-- ============================================================================

create or replace function op_list_alerts(p_status text default null)
returns table (
  id uuid, cafe_id uuid, cafe_name text, alert_type text, severity text, message text,
  detected_at timestamptz, status text,
  acknowledged_by uuid, acknowledged_at timestamptz,
  resolved_by uuid, resolved_at timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  if not has_platform_permission('alerts.view') then raise exception 'not authorized'; end if;
  if p_status is not null and p_status not in ('open', 'acknowledged', 'resolved') then
    raise exception 'invalid status: %', p_status;
  end if;

  insert into platform_alerts (cafe_id, alert_type, severity, message, detected_at)
  select v.cafe_id, v.alert_type, v.severity, v.message, v.detected_at from v_live_alert_signals v
  on conflict (cafe_id, alert_type) where status in ('open', 'acknowledged')
  do update set message = excluded.message, severity = excluded.severity;

  with cleared as (
    update platform_alerts pa
    set status = 'resolved', resolved_at = now(), resolved_by = null
    where pa.status in ('open', 'acknowledged')
      and not exists (select 1 from v_live_alert_signals v where v.cafe_id = pa.cafe_id and v.alert_type = pa.alert_type)
    returning pa.id, pa.cafe_id, pa.alert_type
  )
  insert into platform_audit_logs (actor_id, action, target_type, target_id, new_value)
  select null, 'alert.auto_resolved', 'alert', cleared.id, jsonb_build_object('cafe_id', cleared.cafe_id, 'alert_type', cleared.alert_type)
  from cleared;

  return query
  select pa.id, pa.cafe_id, c.name, pa.alert_type, pa.severity, pa.message, pa.detected_at, pa.status,
         pa.acknowledged_by, pa.acknowledged_at, pa.resolved_by, pa.resolved_at
  from platform_alerts pa
  join cafes c on c.id = pa.cafe_id
  where p_status is null or pa.status = p_status
  order by
    case pa.status when 'open' then 0 when 'acknowledged' then 1 else 2 end,
    case pa.severity when 'critical' then 0 else 1 end,
    pa.detected_at desc
  limit 300;
end $$;

-- ── self-check: prove it actually runs, not just parses ────────────────────
do $$
begin
  begin perform op_list_alerts();
  exception
    when insufficient_privilege then null;
    when others then
      if sqlerrm like '%not authorized%' then null; else raise; end if;
  end;
end $$;
