-- ============================================================================
-- op_list_alerts() STILL threw "column reference \"cafe_id\" is ambiguous"
-- after 0174 -- confirmed live via pg_get_functiondef that 0174's fix (fully
-- qualifying the INSERT's source SELECT with the `v.` alias) had genuinely
-- landed, yet the error persisted unchanged. Root cause: 0174 only qualified
-- what CAN be qualified. It missed the one place that structurally CANNOT
-- be:
--
--   on conflict (cafe_id, alert_type) where status in ('open', 'acknowledged')
--
-- Postgres's grammar requires the ON CONFLICT target list to be bare column
-- names -- `on conflict (pa.cafe_id, ...)` is not valid syntax, for any
-- function, ever. Its WHERE predicate must also textually match the
-- partial unique index's own predicate (platform_alerts_live_idx), which is
-- itself defined with bare `status`. Both `cafe_id`/`alert_type` (target
-- list) and `status` (predicate) collide with op_list_alerts' own
-- RETURNS TABLE OUT-parameter variables of identical names -- the same
-- ambiguity class as before, just in the one spot manual qualification
-- can't reach.
--
-- Fix: PL/pgSQL's own documented escape hatch for exactly this situation --
-- the `#variable_conflict use_column` compiler directive, placed as the
-- first line of the function body. It tells PL/pgSQL that whenever a bare
-- identifier could resolve to either a table column or one of its own
-- variables, prefer the table column -- which is unambiguously the correct
-- choice here (op_list_alerts never actually reads or assigns its own
-- OUT-parameter variables directly by bare name anywhere in this body; they
-- exist only to shape RETURNS TABLE and get populated via `return query`).
-- The existing explicit qualification from 0174 (v.cafe_id, pa.cafe_id,
-- cleared.cafe_id, etc.) is left in place -- harmless, and still the
-- clearer form wherever qualification is actually possible.
--
-- Rest of the body is otherwise byte-for-byte identical to the live,
-- confirmed-deployed 0174 body (pulled directly via pg_get_functiondef,
-- not reconstructed from the migration file, to guarantee no drift).
-- ============================================================================

create or replace function op_list_alerts(p_status text default null)
returns table (
  id uuid, cafe_id uuid, cafe_name text, alert_type text, severity text, message text,
  detected_at timestamptz, status text,
  acknowledged_by uuid, acknowledged_at timestamptz,
  resolved_by uuid, resolved_at timestamptz
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
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

-- ── self-check: prove it actually parses and reaches the permission gate.
-- Migrations run with no auth.uid(), so 'not authorized' is the expected,
-- successful outcome here -- same pattern as every prior migration's
-- self-check in this repo. This does NOT prove the ambiguity is gone (that
-- requires a real authenticated session, past the permission check) -- only
-- a live RPC call, done separately after this lands, can prove that. ───────
do $$
begin
  begin perform op_list_alerts();
  exception
    when insufficient_privilege then null;
    when others then
      if sqlerrm like '%not authorized%' then null; else raise; end if;
  end;
end $$;
