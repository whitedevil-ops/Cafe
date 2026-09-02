-- ============================================================================
-- 0212 — Fix a regression 0211 introduced an hour earlier: deleting a table
-- became impossible.
--
-- 0211 put a BEFORE DELETE trigger on payments that refuses unless "the parent
-- is already gone", and it took the parent to be the CAFÉ. That is right for
-- orders, whose only cascading parent is cafes. It is wrong for payments,
-- which have three:
--
--   payments.cafe_id    -> cafes(id)          on delete cascade
--   payments.order_id   -> orders(id)         on delete cascade
--   payments.session_id -> table_sessions(id) on delete cascade   <- missed
--
-- and table_sessions.table_id -> cafe_tables(id) on delete cascade (0012:21).
--
-- So the live chain is: an owner deletes a table on Tables & QR
-- (app/dashboard/tables/tables-client.tsx:121, a real button behind a confirm
-- dialog) -> cafe_tables row goes -> its table_sessions cascade -> their
-- session-level payments cascade -> 0211's trigger raises, because the café is
-- still very much there. The delete fails and the owner sees
-- "refusing to delete a payments row". Session-level payments are not exotic:
-- record_session_payment writes them every time someone settles a whole table
-- at once.
--
-- I shipped 0211 an hour ago and did not check what else cascades into
-- payments. This is that check, applied.
--
-- THE RULE, stated properly this time: a financial row may be deleted only as
-- part of one of ITS OWN cascades — meaning at least one parent that would
-- cascade it away is already gone in this transaction. Enumerated per table,
-- rather than assumed:
--
--   orders       cafes only (table_id, customer_id, session_id and staff_id are
--                all ON DELETE SET NULL, so none of them can remove an order)
--   order_items  orders only (menu_item_id, variant_id, combo_id and reward_id
--                are all SET NULL)
--   payments     cafes, orders, or table_sessions
--
-- Everything else about 0211 stands: the refusal, the escape hatch, the audit
-- row on deliberate deletion.
-- ============================================================================

create or replace function refuse_financial_delete()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_parent_gone boolean;
  v_allowed     boolean := coalesce(current_setting('app.allow_financial_delete', true), '') = 'on';
  v_cafe        uuid;
begin
  if tg_table_name = 'order_items' then
    -- Only orders cascade here. A null cafe_id means the order is already gone,
    -- which is exactly the cascade we are permitting.
    select o.cafe_id into v_cafe from orders o where o.id = old.order_id;
    v_parent_gone := v_cafe is null;

  elsif tg_table_name = 'payments' then
    v_cafe := old.cafe_id;
    v_parent_gone :=
         not exists (select 1 from cafes where id = old.cafe_id)
      or (old.order_id is not null and not exists (select 1 from orders where id = old.order_id))
      -- The one 0211 missed. Deleting a table cascades through its sessions to
      -- the payments taken against them.
      or (old.session_id is not null and not exists (select 1 from table_sessions where id = old.session_id));

  else -- orders
    v_cafe := old.cafe_id;
    v_parent_gone := not exists (select 1 from cafes where id = old.cafe_id);
  end if;

  if v_parent_gone then
    return old;
  end if;

  if not v_allowed then
    raise exception
      'refusing to delete from % — bills, bill lines and payments are financial records. Cancel the order instead (cancel_order), or, if this really must go, run it inside a transaction with: set local app.allow_financial_delete = ''on'';',
      tg_table_name;
  end if;

  if v_cafe is not null then
    insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
    values (
      v_cafe, auth.uid(), 'financial.row_deleted', tg_table_name, old.id,
      jsonb_build_object('deliberate', true, 'table', tg_table_name)
    );
  end if;

  return old;
end $$;

-- ── self-check ─────────────────────────────────────────────────────────────
do $$
declare v_src text;
begin
  select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'refuse_financial_delete';
  if v_src is null then raise exception 'refuse_financial_delete is missing'; end if;

  -- The actual fix. Without this clause an owner cannot delete a table.
  if position('table_sessions where id = old.session_id' in v_src) = 0 then
    raise exception 'the payments guard still ignores the table_sessions cascade';
  end if;

  -- And the two that were already right must not have been lost in the rewrite.
  if position('from cafes where id = old.cafe_id' in v_src) = 0 then
    raise exception 'the guard lost its cafes cascade exemption';
  end if;
  if position('app.allow_financial_delete' in v_src) = 0 then
    raise exception 'the guard lost its deliberate-deletion escape hatch';
  end if;

  -- 0211's triggers are unchanged by this migration and must still be attached.
  if (select count(*) from pg_trigger
       where tgname in ('trg_refuse_delete_orders','trg_refuse_delete_order_items','trg_refuse_delete_payments')
         and not tgisinternal) <> 3 then
    raise exception 'one of the three delete guards is no longer attached';
  end if;
end $$;
