-- ============================================================================
-- 0050 — F-01: enforce financial rules in POSTGRES, not just in React.
--
-- BEFORE: every financial table carried
--     create policy "member all" on <t> for all
--       using (is_cafe_member(cafe_id)) with check (is_cafe_member(cafe_id))
-- so ANY authenticated café member — cashier, waiter, kitchen — could take
-- their JWT from DevTools and call PostgREST directly to:
--     PATCH /orders   {"payment_status":"paid","total":1}   (fake a payment)
--     POST  /payments {"amount":1}                          (fabricate money)
--     DELETE /payments                                       (erase the ledger)
--     PATCH /order_items {"price":0}                         (under-charge)
-- The RPC layer (place_order, record_payment, refund_order, role-based discount
-- caps) was the INTENDED path but never the ENFORCED one.
--
-- AFTER: these tables are READ-ONLY to café members. Every mutation must go
-- through a SECURITY DEFINER RPC that validates amounts, checks roles and
-- writes the audit trail. Two independent layers are applied on purpose:
--   1. RLS  — "member read" replaces "member all" (row + command scoping)
--   2. GRANT — insert/update/delete revoked from authenticated & anon
-- Either alone would do; together, restoring one by mistake is not enough to
-- reopen the hole.
--
-- PRESERVED (verified against the codebase before writing this):
--   * orders.status / done_at — the KDS and floor screens legitimately advance
--     a ticket. Kept alive with a COLUMN-level UPDATE grant so those two
--     columns stay writable while total/payment_status/subtotal/tax do not.
--   * service_role is never revoked -> the Razorpay webhook (admin client)
--     still records verified payments.
--   * SECURITY DEFINER functions run as their owner, so place_order,
--     staff_place_order, record_payment, record_session_payment, refund_order,
--     cancel_order, record_inventory_movement, apply_order_taxes and the GST
--     invoice trigger all keep working unchanged.
--
-- Multi-tenant isolation is untouched: every policy still keys on
-- is_cafe_member(cafe_id).
-- ============================================================================

-- ── 1. Orders: read + advance-status only ──────────────────────────────────
drop policy if exists "member all" on orders;
create policy "member read" on orders
  for select using (is_cafe_member(cafe_id));

-- Operational state changes stay possible for staff (KDS/floor), but the
-- COLUMN grant below is what actually limits them to status/done_at.
create policy "member advance status" on orders
  for update using (is_cafe_member(cafe_id))
          with check (is_cafe_member(cafe_id));

revoke insert, update, delete on orders from authenticated, anon;
grant update (status, done_at) on orders to authenticated;

-- ── 2. Tables that become strictly read-only to members ────────────────────
-- order_items keys off its parent order rather than a cafe_id column.
drop policy if exists "member all" on order_items;
create policy "member read" on order_items
  for select using (exists (
    select 1 from orders o where o.id = order_id and is_cafe_member(o.cafe_id)));
revoke insert, update, delete on order_items from authenticated, anon;

drop policy if exists "member all" on payments;
create policy "member read" on payments
  for select using (is_cafe_member(cafe_id));
revoke insert, update, delete on payments from authenticated, anon;

drop policy if exists "member all" on expenses;
create policy "member read" on expenses
  for select using (is_cafe_member(cafe_id));
revoke insert, update, delete on expenses from authenticated, anon;

drop policy if exists "member all" on inventory_items;
create policy "member read" on inventory_items
  for select using (is_cafe_member(cafe_id));
revoke insert, update, delete on inventory_items from authenticated, anon;

drop policy if exists "member all" on inventory_transactions;
create policy "member read" on inventory_transactions
  for select using (is_cafe_member(cafe_id));
revoke insert, update, delete on inventory_transactions from authenticated, anon;

drop policy if exists "member all" on loyalty_accounts;
create policy "member read" on loyalty_accounts
  for select using (is_cafe_member(cafe_id));
revoke insert, update, delete on loyalty_accounts from authenticated, anon;

drop policy if exists "member all" on loyalty_transactions;
create policy "member read" on loyalty_transactions
  for select using (is_cafe_member(cafe_id));
revoke insert, update, delete on loyalty_transactions from authenticated, anon;

drop policy if exists "member all" on coupons;
create policy "member read" on coupons
  for select using (is_cafe_member(cafe_id));
revoke insert, update, delete on coupons from authenticated, anon;

drop policy if exists "member all" on coupon_redemptions;
create policy "member read" on coupon_redemptions
  for select using (is_cafe_member(cafe_id));
revoke insert, update, delete on coupon_redemptions from authenticated, anon;

-- Refunds/cash already used the correct "member read" + RPC pattern (0028/0029);
-- revoke the leftover table grants too so both layers agree.
revoke insert, update, delete on refunds, refund_items from authenticated, anon;
revoke insert, update, delete on cash_shifts, cash_movements from authenticated, anon;

-- ── 3. Expenses move to authorized RPCs ────────────────────────────────────
-- Expenses feed net-profit reporting, so they are owner/manager territory.
-- This is an intentional privilege reduction: a cashier could previously
-- insert and delete expense records directly.
create or replace function record_expense(
  p_cafe_id  uuid,
  p_category text,
  p_amount   integer,
  p_vendor   text default null,
  p_method   text default null,
  p_notes    text default null,
  p_spent_on date default current_date
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_cat text;
begin
  if not has_cafe_role(p_cafe_id, array['owner','manager']::member_role[]) then
    raise exception 'only an owner or manager can record expenses';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be greater than zero';
  end if;
  v_cat := nullif(trim(coalesce(p_category, '')), '');
  if v_cat is null then raise exception 'category is required'; end if;

  insert into expenses (cafe_id, category, amount, vendor, method, notes, spent_on)
  values (p_cafe_id, v_cat, p_amount,
          nullif(trim(coalesce(p_vendor, '')), ''),
          nullif(trim(coalesce(p_method, '')), ''),
          nullif(trim(coalesce(p_notes, '')), ''),
          coalesce(p_spent_on, current_date))
  returning id into v_id;

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (p_cafe_id, auth.uid(), 'expense.recorded', 'expenses', v_id,
          jsonb_build_object('amount', p_amount, 'category', v_cat));

  return (select to_jsonb(e) from expenses e where e.id = v_id);
end $$;
revoke execute on function record_expense(uuid, text, integer, text, text, text, date) from public, anon;
grant execute on function record_expense(uuid, text, integer, text, text, text, date) to authenticated;

create or replace function delete_expense(p_expense_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_cafe uuid; v_amount integer;
begin
  select cafe_id, amount into v_cafe, v_amount from expenses where id = p_expense_id;
  if v_cafe is null then raise exception 'expense not found'; end if;
  if not has_cafe_role(v_cafe, array['owner','manager']::member_role[]) then
    raise exception 'only an owner or manager can delete an expense';
  end if;

  delete from expenses where id = p_expense_id;

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (v_cafe, auth.uid(), 'expense.deleted', 'expenses', p_expense_id,
          jsonb_build_object('amount', v_amount));
end $$;
revoke execute on function delete_expense(uuid) from public, anon;
grant execute on function delete_expense(uuid) to authenticated;
