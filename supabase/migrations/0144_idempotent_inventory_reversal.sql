-- ============================================================================
-- 0144 — HIGH: reverse_stock_for_cancelled_order had no idempotency guard —
--        it always re-summed and re-credited the SAME deduction ledger rows
--        on every call, so any path that could invoke it twice for the same
--        order double-restocked that order's ingredients.
--
-- CONFIRMED BY A 12-AGENT AUDIT WITH INDEPENDENT ADVERSARIAL RE-VERIFICATION.
--
-- cancel_order (0060, latest body 0071) already blocks re-cancelling an
-- already-cancelled order — `if v_status in ('completed', 'cancelled') then
-- raise exception`. But that check and the `update orders set status =
-- 'cancelled' ...` that follows it are two separate statements, not one
-- atomic claim: two concurrent cancel_order calls for the same order (a
-- genuine double-click, or a client retry after a slow/dropped response) can
-- both read status <> 'cancelled' before either commits its UPDATE — the
-- exact same check-before-lock race already fixed for wallet_confirm_topup
-- in 0139. Both then call reverse_stock_for_cancelled_order, and because
-- that function has no memory of "have I already reversed this order,"
-- both re-sum the same `inventory_transactions` rows (via order_item_id,
-- 0071's own ledger-as-source-of-truth design) and both credit
-- inventory_items.current_stock — a real double-restock, not a hypothetical
-- one.
--
-- refund_order (0028..0098, current) never touches inventory in any of its
-- branches (cash/card/upi/wallet, full/partial/item-level) — refund stays
-- purely financial by design (0060's own stated rationale). So a refund
-- itself cannot double-trigger a reversal; the only path in is a cancel_order
-- race/retry, which this migration closes directly.
--
-- THE FIX
-- orders.stock_reversed_at is the explicit idempotency marker the mandate
-- asks for. reverse_stock_for_cancelled_order claims it with a single
-- conditional UPDATE (`where id = p_order_id and stock_reversed_at is
-- null`) as its very first action, before touching anything else. Under
-- MVCC this UPDATE is the actual point of serialization: whichever
-- concurrent call commits first wins the claim; the loser's WHERE clause no
-- longer matches once the winner's row is visible, so `FOUND` is false and
-- it returns immediately — no separate advisory lock needed, because a
-- single UPDATE against one row is already atomic. A genuine error later in
-- the reversal (caught by the existing `exception when others` swallow)
-- rolls the claim back too, via the implicit savepoint the block already
-- establishes — correct, since a reversal that didn't actually happen
-- should remain eligible for a future retry.
--
-- Covered by tests/integration/inventory-reversal.test.ts: cancel-before-prep,
-- cancel-after-prep, full refund then cancel, partial refund (confirmed
-- unreachable — payment_status stays 'paid', which cancel_order's own
-- pre-existing guard already blocks before reversal is ever reached), and a
-- real concurrent-cancel race via Promise.all. That suite requires this
-- migration (and 0060/0071, which it already assumed) to be live — it has
-- not been run against the live database yet, so these scenarios are
-- verified by code inspection here, not yet by a live test run.
-- ============================================================================

alter table orders add column if not exists stock_reversed_at timestamptz;

create or replace function reverse_stock_for_cancelled_order(p_order_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id uuid;
  v_enabled boolean;
  v_short   text;
  v_r       record;
begin
  begin
    -- Idempotency claim — see migration header for why this is race-safe on
    -- its own with no additional lock.
    update orders set stock_reversed_at = now()
      where id = p_order_id and stock_reversed_at is null;
    if not found then return; end if;

    select cafe_id, short_code into v_cafe_id, v_short from orders where id = p_order_id;
    if v_cafe_id is null then return; end if;

    select auto_deduct_stock into v_enabled from cafes where id = v_cafe_id;
    if not coalesce(v_enabled, false) then return; end if;

    for v_r in
      select it.item_id as inventory_item_id, sum(-it.delta) as total_qty
        from inventory_transactions it
        join order_items oi on oi.id = it.order_item_id
       where oi.order_id = p_order_id and it.order_item_id is not null
       group by it.item_id
    loop
      update inventory_items
        set current_stock = current_stock + v_r.total_qty
        where id = v_r.inventory_item_id and cafe_id = v_cafe_id;

      insert into inventory_transactions (cafe_id, item_id, delta, reason)
      values (v_cafe_id, v_r.inventory_item_id, v_r.total_qty,
              'Auto: order ' || coalesce(v_short, '') || ' cancelled — stock restored');
    end loop;
  exception when others then
    -- Same rule as the forward deduction: stock bookkeeping can never block
    -- or fail a cancellation.
    null;
  end;
end $$;

revoke execute on function reverse_stock_for_cancelled_order(uuid) from public, anon, authenticated;
