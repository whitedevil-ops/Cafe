-- ============================================================================
-- 0153 — Write off a stale/abandoned table, and clear its notifications on
-- close either way.
--
-- FOUND LIVE: a real pilot café had 16 tables stuck "occupied" for 9-11 days
-- straight (₹27k+ combined), with literally no action anywhere in the UI to
-- get out of that state — close_session (0069) deliberately REFUSES to close
-- while money is owed, which is correct for the normal case (an owner must
-- not lose track of a real unpaid bill) but leaves no answer for "the
-- customer already left without paying" or "staff forgot to close this out
-- three days ago." This migration adds the one deliberate, audited exception
-- to that rule.
--
-- Also fixed in passing: closing a table (either way) never cleared its
-- notifications — a live café had 20 unread "waiter called" alerts sitting
-- in the notification center for tables that had been closed and empty for
-- days, because nothing ever marked them read.
-- ============================================================================

-- ── Write off ────────────────────────────────────────────────────────────────
-- Owner/manager only, reason required, fully audited. Marks every open order
-- completed first (same transition advance()'s own "Done" step performs) so
-- close_session's own order-status invariant is honestly satisfied rather
-- than bypassed — only the payment requirement is deliberately skipped here.
create or replace function write_off_session(p_session_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id     uuid;
  v_table       uuid;
  v_outstanding integer;
  v_reason      text;
begin
  select cafe_id, table_id into v_cafe_id, v_table from table_sessions where id = p_session_id;
  if v_cafe_id is null then raise exception 'session not found'; end if;
  if not has_cafe_role(v_cafe_id, array['owner','manager']::member_role[]) then
    raise exception 'only an owner or manager can write off a table';
  end if;

  v_reason := trim(coalesce(p_reason, ''));
  if v_reason = '' then raise exception 'a reason is required to write off a table'; end if;

  update orders set status = 'completed', done_at = coalesce(done_at, now())
   where session_id = p_session_id and status not in ('completed','cancelled');

  select coalesce(sum(order_outstanding(o.id)), 0) into v_outstanding
    from orders o where o.session_id = p_session_id and o.status <> 'cancelled';

  update table_sessions set status = 'closed', closed_at = now(), closed_by = auth.uid() where id = p_session_id;
  update cafe_tables set status = 'available' where id = v_table;
  update notifications set read = true where session_id = p_session_id and read = false;

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (v_cafe_id, auth.uid(), 'table.written_off', 'table_sessions', p_session_id,
          jsonb_build_object('reason', v_reason, 'amount_written_off', v_outstanding, 'table_id', v_table));

  return jsonb_build_object('amount_written_off', v_outstanding);
end $$;

revoke execute on function write_off_session(uuid, text) from public, anon;
grant execute on function write_off_session(uuid, text) to authenticated;

-- ── close_session: same signature, now also clears its own notifications ──
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
  update notifications set read = true where session_id = p_session_id and read = false;
end $$;

revoke execute on function close_session(uuid) from public, anon;
grant execute on function close_session(uuid) to authenticated;
