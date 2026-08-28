-- ============================================================================
-- Full-audit finding, high: only wallet_start_topup checked cafe_has_feature
-- ('wallet') server-side. customer_wallet_state, wallet_charge_order (the
-- single shared core BOTH spend paths delegate to), wallet_pay_order,
-- wallet_pay_for_order, and wallet_adjust did not -- exactly the "UI hides
-- the button but the RPC still works" bypass class migrations 0143/0166
-- already closed for coupons/loyalty/spin/crm/inventory/expenses/feedback/
-- advanced_analytics. Live-verified on the real pilot café Brewora (starter
-- plan, features.wallet=false): calling wallet_adjust directly created a
-- real ₹1 spendable wallet balance with no entitlement error, despite the
-- dashboard Wallet page correctly redirecting to UpgradeRequired.
--
-- Fixed at wallet_charge_order (the one function both wallet_pay_order and
-- wallet_pay_for_order call for every actual spend, so gating it there
-- closes both at once) and wallet_adjust (the standalone credit/debit path).
-- customer_wallet_state (read-only balance/history display) is left
-- ungated: it already degrades gracefully to a ₹0/empty state today, and
-- once these two write paths are closed, a non-entitled café's wallet can
-- never actually carry a nonzero balance to display in the first place --
-- this is a display concern, not the security-relevant path, and changing
-- it to a hard error would require reworking the customer-facing wallet
-- page's already-correct graceful-degradation UI.
--
-- A SEPARATE, deeper finding from the same audit pass -- customer wallet
-- identity has no device-continuity check the way customer_order_history
-- does (migration 0087), so anyone who knows a customer's phone number can
-- read/spend their real wallet balance from an unrelated device, no OTP --
-- is NOT fixed here. It is currently dormant (no café in production has
-- wallet enabled), but closing it properly means either extending
-- device-scoping to wallet (a real UX tradeoff: balance would no longer be
-- reachable from a new device) or reinstating phone verification (already
-- attempted once, in migration 0088, and reverted the same day in 0089
-- because the SMS provider was never actually configured and it took
-- ordering itself offline). That is a real product/infrastructure decision,
-- not something to make unilaterally inside an audit-fix pass -- flagged to
-- the user directly instead.
-- ============================================================================

create or replace function wallet_charge_order(p_cafe_id uuid, p_customer_id uuid, p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_order   record;
  v_paid    integer;
  v_due     integer;
  v_balance integer;
  v_payment_id uuid;
begin
  if not cafe_has_feature(p_cafe_id, 'wallet') then
    raise exception 'wallet is not available on this café''s plan';
  end if;

  select id, total, cafe_id, customer_id into v_order from orders where id = p_order_id and cafe_id = p_cafe_id;
  if v_order.id is null then raise exception 'order not found'; end if;
  if v_order.customer_id is distinct from p_customer_id then
    raise exception 'this order is not linked to this wallet';
  end if;

  -- Lock BEFORE computing what's due, not after — otherwise two concurrent
  -- calls for the same order (a network retry, a double-tap) could both
  -- read "amount due" before either has paid, then both charge the wallet
  -- once the lock serializes them, double-charging for one order. Locking
  -- first means the second call re-reads payments AFTER the first one's
  -- insert has landed, so it correctly sees the order as already paid.
  perform pg_advisory_xact_lock(hashtext('wallet:' || p_cafe_id::text || ':' || p_customer_id::text));

  select coalesce(sum(amount), 0) into v_paid from payments where order_id = p_order_id;
  v_due := v_order.total - v_paid;
  if v_due <= 0 then raise exception 'this order is already paid'; end if;

  v_balance := coalesce((select sum(amount) from wallet_transactions
    where cafe_id = p_cafe_id and customer_id = p_customer_id), 0);
  if v_balance < v_due then
    raise exception 'wallet balance (₹%) is less than the amount due (₹%)', v_balance, v_due;
  end if;

  insert into wallet_transactions (cafe_id, customer_id, kind, amount, order_id, reason)
  values (p_cafe_id, p_customer_id, 'spend', -v_due, p_order_id, 'Order payment');

  insert into payments (cafe_id, order_id, method, amount, source, status, verified_at)
  values (p_cafe_id, p_order_id, 'wallet', v_due, 'wallet', 'captured', now())
  returning id into v_payment_id;

  perform recompute_order_payment_status(p_order_id);

  return jsonb_build_object('paid', v_due, 'new_balance', v_balance - v_due, 'payment_id', v_payment_id);
end $$;
revoke execute on function wallet_charge_order(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function wallet_adjust(p_cafe_id uuid, p_customer_id uuid, p_amount integer, p_reason text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_balance integer;
begin
  if not has_cafe_role(p_cafe_id, array['owner','manager']::member_role[]) then
    raise exception 'only an owner or manager can adjust a wallet balance';
  end if;
  if not cafe_has_feature(p_cafe_id, 'wallet') then
    raise exception 'wallet is not available on this café''s plan';
  end if;
  if p_amount = 0 then raise exception 'amount cannot be zero'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'a reason is required'; end if;

  perform pg_advisory_xact_lock(hashtext('wallet:' || p_cafe_id::text || ':' || p_customer_id::text));

  insert into wallet_transactions (cafe_id, customer_id, kind, amount, reason, created_by)
  values (p_cafe_id, p_customer_id, 'adjustment', p_amount, trim(p_reason), auth.uid());

  select coalesce(sum(amount), 0) into v_balance from wallet_transactions
    where cafe_id = p_cafe_id and customer_id = p_customer_id;
  return v_balance;
end $$;
revoke execute on function wallet_adjust(uuid, uuid, integer, text) from public, anon;
grant execute on function wallet_adjust(uuid, uuid, integer, text) to authenticated;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_proc where proname = 'wallet_charge_order') <> 1 then
    raise exception 'wallet_charge_order: expected exactly one overload';
  end if;
  if (select count(*) from pg_proc where proname = 'wallet_adjust') <> 1 then
    raise exception 'wallet_adjust: expected exactly one overload';
  end if;
end $$;
