-- ============================================================================
-- 0141 — CRITICAL: five more internal SQL helpers were left directly
--        callable by any authenticated user, disclosing or (in one case)
--        mutating another café's order/payment/kitchen data. Same class of
--        bug as 0137 (apply_order_taxes) and 0138 (resolve_coupon_discount):
--        each has zero authorization check in its body, and each was found
--        by the same 12-agent SECURITY DEFINER classification sweep that
--        flagged those two.
--
-- CONFIRMED BY A 12-AGENT AUDIT WITH INDEPENDENT ADVERSARIAL RE-VERIFICATION.
-- Independently re-verified here: read every function body listed below at
-- its current live definition, and grepped app/, lib/, components/ for a
-- literal `.rpc('<name>', ...)` call — zero direct app-code callers exist
-- for the first four; recompute_order_payment_status has exactly one, the
-- Razorpay webhook route, using the service-role client, not a user session.
--
-- 1. order_outstanding(p_order_id) — 0041:7. No auth check; resolves an
--    order's outstanding balance from `orders`/`payments` by ID alone.
--    Reachable cross-tenant: any authenticated user could learn any order's
--    unpaid amount. Internal callers only (record_payment, close_session,
--    outstanding_summary) — never called from app code.
--
-- 2. order_refunded_total(p_order_id) — 0028:70. No auth check; sums
--    completed refunds for an order by ID alone. Same cross-tenant
--    disclosure shape. Internal callers only (refund_order, order_settlement,
--    list_bill_receipts) — never called from app code.
--
-- 3. bill_status(p_order_id) — 0039:61. No auth check; derives a coarse
--    PAID/REFUNDED/PARTIALLY_REFUNDED/PAYMENT_PENDING/OPEN/CANCELLED status
--    for any order by ID. Same shape. Internal callers only (bill_detail) —
--    the identically-named `bill_status` field the UI actually reads comes
--    back from list_bills/bill_detail's JSON, never a direct RPC call.
--
-- 4. build_kot_payload(p_order_id, p_printer_id) — 0027:142. No auth check;
--    returns a full kitchen-ticket payload — item names, quantities,
--    modifiers, prep notes, table label — for any (order_id, printer_id)
--    pair on the platform. Worse than the first three: this discloses order
--    CONTENTS, not just a status/total. Internal callers only
--    (enqueue_kot_jobs trigger, reprint_kot — which itself already checks
--    has_cafe_role and scopes the printer to its own café before calling
--    this) — never called from app code.
--
-- 5. recompute_order_payment_status(p_order_id) — 0041/0048. No auth check;
--    WRITES orders.payment_status, recomputed from the real payments ledger
--    (unpaid/partial/paid only — never fabricates a status a payment total
--    doesn't support, and never touches a refunded or cancelled order). Its
--    one real caller is app/api/payments/razorpay/webhook/[token]/route.ts,
--    using the service-role admin client — the exact same shape
--    wallet_confirm_topup was in before 0119 restricted it to service_role.
--    Fixed the same way here, for the same reason.
--
-- THE FIX
-- Same architecture as 0137/0138: these are internal helpers with exactly
-- one legitimate caller shape each (another SECURITY DEFINER function that
-- has already authorized its own request, or — for #5 — a service-role
-- webhook). Revoking `authenticated`'s direct grant does not break any of
-- them, because a SECURITY DEFINER caller's internal calls execute as the
-- function owner regardless of what `authenticated` may call directly.
-- Function bodies are completely untouched — only grants change.
-- ============================================================================

revoke execute on function order_outstanding(uuid) from public, anon, authenticated;
revoke execute on function order_refunded_total(uuid) from public, anon, authenticated;
revoke execute on function bill_status(uuid) from public, anon, authenticated;
revoke execute on function build_kot_payload(uuid, uuid) from public, anon, authenticated;

-- recompute_order_payment_status: authenticated out, service_role in — the
-- one real caller is the Razorpay webhook's service-role admin client.
revoke execute on function recompute_order_payment_status(uuid) from public, anon, authenticated;
grant execute on function recompute_order_payment_status(uuid) to service_role;

do $$
begin
  if has_function_privilege('authenticated', 'order_outstanding(uuid)', 'execute') then
    raise exception 'order_outstanding is still directly callable by authenticated — lockdown failed';
  end if;
  if has_function_privilege('authenticated', 'order_refunded_total(uuid)', 'execute') then
    raise exception 'order_refunded_total is still directly callable by authenticated — lockdown failed';
  end if;
  if has_function_privilege('authenticated', 'bill_status(uuid)', 'execute') then
    raise exception 'bill_status is still directly callable by authenticated — lockdown failed';
  end if;
  if has_function_privilege('authenticated', 'build_kot_payload(uuid, uuid)', 'execute') then
    raise exception 'build_kot_payload is still directly callable by authenticated — lockdown failed';
  end if;
  if has_function_privilege('authenticated', 'recompute_order_payment_status(uuid)', 'execute') then
    raise exception 'recompute_order_payment_status is still directly callable by authenticated — lockdown failed';
  end if;
  if not has_function_privilege('service_role', 'recompute_order_payment_status(uuid)', 'execute') then
    raise exception 'recompute_order_payment_status was not granted to service_role — webhook would break';
  end if;
end $$;
