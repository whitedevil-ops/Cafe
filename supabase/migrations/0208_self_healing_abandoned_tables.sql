-- ============================================================================
-- 0208 — Abandoned tables clear themselves now, instead of needing a migration
-- to be written every time they pile up.
--
-- REPORTED LIVE AGAIN (2026-09-02), which is the whole point of this file.
-- Migration 0202 wrote close_abandoned_table_sessions(), ran it ONCE inline to
-- clear a backlog, granted it to service_role, and stopped. Nothing ever
-- called it again — no cron entry, no route, and service_role means nothing in
-- the app could have. So Brewora came back with two more within hours:
--
--   T09  455 minutes, session active,         0 orders ever
--   14   455 minutes, session bill_requested, 0 orders ever
--
-- A sweep with no scheduler is a one-time cleanup wearing a function's
-- clothes. This gives it a caller.
--
-- WHY NOT A CRON: the deployment is on Vercel with two cron jobs already
-- defined, which is the Hobby-plan ceiling, and a third would risk the deploy
-- of a live product to fix a cosmetic-but-annoying bug. It would also be worse
-- than what is below: a nightly sweep clears a table hours after anyone cared,
-- whereas this clears it the moment a member of staff looks at the floor —
-- which is exactly when it matters and exactly when it was reported.
--
-- The UI half of this bug is fixed in app/dashboard/tables/floor-client.tsx:
-- the Close button required selOrders.length > 0, so on a session with no
-- orders it sat disabled reading "Complete all orders to close table" — about
-- orders that do not exist. Staff had no way to clear these by hand, which is
-- why a server-side sweep was load-bearing in the first place.
-- ============================================================================

-- ── A café-scoped sweep its own staff are allowed to run ───────────────────
--
-- close_abandoned_table_sessions (0202) sweeps EVERY café and is therefore
-- correctly service_role-only. This is the same logic pinned to one café and
-- gated on membership, so the floor screen can heal its own floor without
-- being handed a platform-wide instrument.
--
-- Safe with respect to close_session's money guard by construction, exactly as
-- 0202 argued: every session this can touch has no non-cancelled order, and
-- therefore no outstanding balance. It cannot free a table that owes anything.
create or replace function close_abandoned_sessions_for_cafe(
  p_cafe_id uuid,
  p_older_than_hours int default 6
)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_closed int := 0;
begin
  if not is_cafe_member(p_cafe_id) then
    raise exception 'not authorized';
  end if;

  with abandoned as (
    select s.id, s.table_id
      from table_sessions s
     where s.cafe_id = p_cafe_id
       and s.status in ('active', 'bill_requested')
       and s.started_at < now() - make_interval(hours => greatest(p_older_than_hours, 0))
       and not exists (
         select 1 from orders o
          where o.session_id = s.id and o.status <> 'cancelled'
       )
  ), shut as (
    update table_sessions t
       set status = 'closed', closed_at = now()
      from abandoned a
     where t.id = a.id
    returning a.table_id
  )
  update cafe_tables c set status = 'available'
    from shut where c.id = shut.table_id;

  get diagnostics v_closed = row_count;
  return v_closed;
end $$;

revoke execute on function close_abandoned_sessions_for_cafe(uuid, int) from public, anon;
grant execute on function close_abandoned_sessions_for_cafe(uuid, int) to authenticated;

-- ── Six hours, not twelve ──────────────────────────────────────────────────
--
-- 0202 picked twelve to be "far longer than any real gap and still clears
-- overnight leftovers". Six is that same argument with the arithmetic redone.
-- The gap this must never interrupt is between seating a guest and sending
-- their first item — minutes, not hours. Twelve meant a table stuck after
-- breakfast was still stuck at dinner, which is what got reported: at seven
-- and a half hours old, the two tables above would have survived a twelve-hour
-- sweep anyway.
create or replace function close_abandoned_table_sessions(p_older_than_hours int default 6)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_closed int := 0;
begin
  with abandoned as (
    select s.id, s.table_id
      from table_sessions s
     where s.status in ('active', 'bill_requested')
       -- 0 means "no age filter at all", which is what the one-time cleanup
       -- below needs: some stuck sessions are only minutes old and would
       -- survive any positive threshold, including the self-check.
       and s.started_at < now() - make_interval(hours => greatest(p_older_than_hours, 0))
       and not exists (
         select 1 from orders o
          where o.session_id = s.id and o.status <> 'cancelled'
       )
  ), shut as (
    update table_sessions t
       set status = 'closed', closed_at = now()
      from abandoned a
     where t.id = a.id
    returning a.table_id
  )
  update cafe_tables c set status = 'available'
    from shut where c.id = shut.table_id;

  get diagnostics v_closed = row_count;
  return v_closed;
end $$;

revoke execute on function close_abandoned_table_sessions(int) from public, anon;
grant execute on function close_abandoned_table_sessions(int) to service_role;

-- ── Clear what is stuck right now ──────────────────────────────────────────
do $$
declare v_n int;
begin
  select close_abandoned_table_sessions(0) into v_n;
  raise notice 'closed % abandoned table session(s)', v_n;
end $$;

-- ── self-check ─────────────────────────────────────────────────────────────
do $$
declare v_left int;
begin
  select count(*) into v_left
    from table_sessions s
   where s.status in ('active', 'bill_requested')
     and not exists (select 1 from orders o where o.session_id = s.id and o.status <> 'cancelled');
  if v_left > 0 then
    raise exception 'still % table session(s) occupying a table with nothing live on them', v_left;
  end if;

  -- 0202's trigger is what catches the other cause (every order on a session
  -- cancelled). It must survive this migration.
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_close_session_when_all_orders_cancelled'
  ) then
    raise exception 'the cancel trigger from 0202 is missing';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'close_abandoned_sessions_for_cafe'
  ) then
    raise exception 'close_abandoned_sessions_for_cafe was not created';
  end if;

  -- The whole point: staff must be able to run the café-scoped one. If this
  -- grant is missing the floor screen silently stops healing itself and we are
  -- back to writing a migration every time tables pile up.
  if not has_function_privilege('authenticated', 'close_abandoned_sessions_for_cafe(uuid, int)', 'execute') then
    raise exception 'authenticated cannot execute close_abandoned_sessions_for_cafe';
  end if;
end $$;
