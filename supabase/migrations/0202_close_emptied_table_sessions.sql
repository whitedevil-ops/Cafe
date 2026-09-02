-- ============================================================================
-- 0202 — Tables stayed "occupied" forever after their orders were cancelled,
-- or after being opened and never ordered on at all.
--
-- REPORTED LIVE (2026-09-02), with the floor screen showing grey ₹0 / 0-item
-- cards nobody could clear:
--   FEAR & FEAST R1  — 955 minutes old, 3 orders, every one cancelled
--   FEAR & FEAST M1  — 1 order, cancelled
--   Brewora T15/T05/T08 — 2309 minutes (38 hours) old, zero orders ever
--
-- WHY IT HAPPENS: a table shows as occupied purely because a table_sessions
-- row is in status 'active'/'bill_requested' (see the floor query in
-- app/dashboard/tables/floor-client.tsx), and the floor deliberately ignores
-- cancelled orders when totalling. close_session() has existed since 0012 and
-- correctly refuses to close a table that still owes money (0069) — but
-- nothing ever CALLS it when a session quietly empties out. Cancelling the
-- last order leaves the session exactly as it was, so the table reads as
-- occupied with nothing on it, and the only way back is a manual Close.
--
-- Two distinct causes, so two distinct remedies below.
-- ============================================================================

-- ── 1. Cancelling the last live order closes the table ─────────────────────
--
-- Only when EVERY order on the session is cancelled. A table with one
-- cancelled order and three live ones is still occupied and must stay that
-- way — this is deliberately not "no un-cancelled orders remain right now",
-- which would yank a table out from under staff who cancel one line while
-- re-entering it.
--
-- Safe with respect to 0069's money guard by construction: outstanding is
-- computed over non-cancelled orders only, so a session whose orders are all
-- cancelled owes exactly zero. Nothing here can close a table that owes money.
create or replace function close_session_when_all_orders_cancelled()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_live int;
  v_table uuid;
begin
  if new.session_id is null then return new; end if;

  select count(*) into v_live
    from orders
   where session_id = new.session_id and status <> 'cancelled';
  if v_live > 0 then return new; end if;

  select table_id into v_table
    from table_sessions
   where id = new.session_id and status in ('active', 'bill_requested');
  if v_table is null then return new; end if;

  update table_sessions
     set status = 'closed', closed_at = now()
   where id = new.session_id;
  -- closed_by is deliberately left null: nobody decided to close this table,
  -- it emptied itself. A null there reads correctly in the audit trail as
  -- "the system", rather than blaming whoever happened to cancel the order.
  update cafe_tables set status = 'available' where id = v_table;
  return new;
end $$;

drop trigger if exists trg_close_session_when_all_orders_cancelled on orders;
create trigger trg_close_session_when_all_orders_cancelled
  after update of status on orders
  for each row
  when (new.status = 'cancelled' and old.status is distinct from 'cancelled')
  execute function close_session_when_all_orders_cancelled();

-- ── 2. Sweep sessions that were opened and never used ──────────────────────
--
-- The trigger above cannot help a session that never had an order at all —
-- there is no order to cancel. Brewora had three of those sitting at 38 hours.
--
-- The grace period is the whole design here. A session legitimately exists
-- with no orders for the minutes between seating a guest and sending the
-- first item, so anything short would close tables out from under staff
-- mid-order. Twelve hours is far longer than any real gap and still clears
-- overnight leftovers before the next service.
create or replace function close_abandoned_table_sessions(p_older_than_hours int default 12)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_closed int := 0;
begin
  with abandoned as (
    select s.id, s.table_id
      from table_sessions s
     where s.status in ('active', 'bill_requested')
       -- 0 means "no age filter at all", which is what the one-time cleanup
       -- below needs: some of the stuck sessions are only minutes old (a
       -- cancelled order from this morning) and would survive any positive
       -- threshold, including the self-check that asserts none are left.
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

-- ── 3. Clear what is already stuck ─────────────────────────────────────────
--
-- The rows above are on real café floors right now. One-time, and written to
-- the same rules as the sweep so it cannot free a table that owes anything:
-- every session touched here has no non-cancelled order, and therefore no
-- outstanding balance.
do $$
declare v_n int;
begin
  select close_abandoned_table_sessions(0) into v_n;
  raise notice 'closed % abandoned table session(s)', v_n;
end $$;

-- ── self-check ───────────────────────────────────────────────────────────
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

  if not exists (
    select 1 from pg_trigger where tgname = 'trg_close_session_when_all_orders_cancelled'
  ) then
    raise exception 'the cancel trigger did not get created';
  end if;
end $$;
