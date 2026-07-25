-- ============================================================================
-- 0069 — close_session let a table close with money still owed.
--
-- REPORTED LIVE: a table with two "Completed · Payment due" orders (₹458 +
-- ₹189 outstanding) could still be closed via the "Close table" button —
-- close_session (0012) only ever checked that every order had reached
-- status = 'completed', never that it had actually been PAID. Closing reset
-- the table to 'available' for the next guests while the old bill was still
-- owed — a real revenue-leakage risk, not just a display glitch.
--
-- FIX: reuse order_outstanding (0041, the same server-computed "total minus
-- confirmed payments" already authoritative everywhere else — Bills,
-- dashboard, the payment buttons in this very drawer) and refuse to close
-- while any non-cancelled order in the session still has a balance.
-- ============================================================================

create or replace function close_session(p_session_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_cafe        uuid;
  v_table       uuid;
  v_open_orders int;
  v_outstanding integer;
begin
  select cafe_id, table_id into v_cafe, v_table from table_sessions where id = p_session_id;
  if v_cafe is null then raise exception 'session not found'; end if;
  if not is_cafe_member(v_cafe) then raise exception 'not authorized'; end if;

  select count(*) into v_open_orders from orders
    where session_id = p_session_id and status not in ('completed','cancelled');
  if v_open_orders > 0 then
    raise exception 'session has % order(s) not yet completed', v_open_orders;
  end if;

  select coalesce(sum(order_outstanding(o.id)), 0) into v_outstanding
    from orders o where o.session_id = p_session_id and o.status <> 'cancelled';
  if v_outstanding > 0 then
    raise exception 'this table still has ₹% outstanding — record payment before closing', v_outstanding;
  end if;

  update table_sessions set status = 'closed', closed_at = now(), closed_by = auth.uid() where id = p_session_id;
  update cafe_tables set status = 'available' where id = v_table;
end $$;

revoke execute on function close_session(uuid) from public, anon;
grant execute on function close_session(uuid) to authenticated;
