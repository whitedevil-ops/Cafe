-- ============================================================================
-- 0211 — The database refuses to delete a bill, a bill line, or a payment.
--
-- WHY: on 2026-09-02 four orders (#4-#7, all guest QR orders on T09 and table
-- 14) were deleted straight out of the orders table. The bill sequence went
-- #3 -> #8 with no explanation, two table sessions were left orphaned holding
-- tables at ₹0, and there was no record of any of it — the audit trail still
-- had the four `order.created` rows, and nothing at all about their removal.
--
-- Reconstructing that took twenty queries. It should have taken none, because
-- it should not have been possible.
--
-- The app never had a way to do it: there is no `delete from orders` in any
-- migration, function, script or test; no `.from('orders').delete()` anywhere
-- in the codebase; no RLS DELETE policy on orders and no DELETE grant — the
-- `authenticated` role holds only `update (status, done_at)` (0050:51). So the
-- deletion came through the service-role key or a direct connection: the
-- Supabase SQL editor, the table editor, or an ad-hoc script.
--
-- Nothing can take that key's power away — that is what it is for. What CAN be
-- done is make the database itself say no, because a trigger fires for the
-- service role exactly as it does for everyone else. An order is a financial
-- record: it gets CANCELLED (cancel_order, which keeps the row and its
-- number), never removed.
--
-- THE ONE DELETE THAT MUST STILL WORK: deleting a café. op_delete_cafe
-- (0102/0163), reset-demo-cafe.sql, seed-demo-cafe.sql and the `afterAll` of
-- every integration test all do `delete from cafes`, which cascades to orders.
-- Blocking that would break the entire integration suite and the operator's
-- own café-removal flow.
--
-- Postgres deletes the parent row FIRST and then fires the FK cascade, so by
-- the time a child's BEFORE DELETE trigger runs, its parent is already gone
-- inside the same transaction. "Is the parent still there?" is therefore an
-- exact discriminator between a cascade (allowed, parent gone) and someone
-- deleting a bill on its own (refused, parent present). No session variable to
-- remember, no test to change, nothing to configure.
--
-- AND A KEY FOR THE DOOR: a lock with no key is a bug waiting for an
-- emergency. A deliberate deletion is still possible with
--
--     begin;
--     set local app.allow_financial_delete = 'on';
--     delete from orders where id = '...';
--     commit;
--
-- which is impossible to type by accident, and which writes its own audit row
-- so the next person does not have to reconstruct it from notifications.
-- ============================================================================

create or replace function refuse_financial_delete()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_parent_gone boolean;
  v_allowed     boolean := coalesce(current_setting('app.allow_financial_delete', true), '') = 'on';
  v_cafe        uuid;
begin
  -- order_items hangs off orders and has no cafe_id of its own; the other two
  -- hang off cafes. In both cases "parent already gone" means we are inside
  -- that parent's ON DELETE CASCADE and this delete is legitimate.
  if tg_table_name = 'order_items' then
    select o.cafe_id into v_cafe from orders o where o.id = old.order_id;
    v_parent_gone := v_cafe is null;
  else
    v_cafe := old.cafe_id;
    v_parent_gone := not exists (select 1 from cafes where id = old.cafe_id);
  end if;

  if v_parent_gone then
    return old;
  end if;

  if not v_allowed then
    raise exception
      'refusing to delete a % row — bills, bill lines and payments are financial records. Cancel the order instead (cancel_order), or, if this really must go, run it inside a transaction with: set local app.allow_financial_delete = ''on'';',
      tg_table_name;
  end if;

  -- Deliberate deletion. Record it, so it is never again something that has to
  -- be reconstructed from leftover notification rows.
  if v_cafe is not null then
    insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
    values (
      v_cafe, auth.uid(), 'financial.row_deleted', tg_table_name, old.id,
      jsonb_build_object('deliberate', true, 'table', tg_table_name)
    );
  end if;

  return old;
end $$;

drop trigger if exists trg_refuse_delete_orders on orders;
create trigger trg_refuse_delete_orders
  before delete on orders
  for each row execute function refuse_financial_delete();

drop trigger if exists trg_refuse_delete_order_items on order_items;
create trigger trg_refuse_delete_order_items
  before delete on order_items
  for each row execute function refuse_financial_delete();

drop trigger if exists trg_refuse_delete_payments on payments;
create trigger trg_refuse_delete_payments
  before delete on payments
  for each row execute function refuse_financial_delete();

-- ── self-check ─────────────────────────────────────────────────────────────
-- Structural only, deliberately. Proving the behaviour needs a café, an order
-- and a real DELETE, and a migration is the wrong place to be creating and
-- destroying rows in a live database to make a point. That proof lives in
-- tests/integration/delete-guard.test.ts, which builds its own throwaway café
-- and checks both halves: the refusal, and that the café cascade still works.
do $$
declare v_missing text;
begin
  select string_agg(t, ', ') into v_missing
    from unnest(array[
      'trg_refuse_delete_orders',
      'trg_refuse_delete_order_items',
      'trg_refuse_delete_payments'
    ]) t
   where not exists (select 1 from pg_trigger where tgname = t and not tgisinternal);
  if v_missing is not null then
    raise exception 'these delete guards were not created: %', v_missing;
  end if;

  -- The escape from the cascade problem. Without it, deleting a café raises
  -- and op_delete_cafe, reset-demo-cafe.sql and every integration test's
  -- cleanup all break at once.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'refuse_financial_delete'
       and p.prosrc like '%v_parent_gone%'
  ) then
    raise exception 'refuse_financial_delete is missing its cascade exemption';
  end if;

  -- And the key for the door.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'refuse_financial_delete'
       and p.prosrc like '%app.allow_financial_delete%'
  ) then
    raise exception 'refuse_financial_delete has no deliberate-deletion escape hatch';
  end if;
end $$;
