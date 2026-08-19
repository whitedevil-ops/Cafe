-- ============================================================================
-- 0137 — CRITICAL: apply_order_taxes had zero authorization check and was
--        directly callable by any authenticated user against any order.
--
-- CONFIRMED BY A 12-AGENT AUDIT WITH INDEPENDENT ADVERSARIAL RE-VERIFICATION.
--
-- apply_order_taxes(p_order_id, p_discount) resolves the order's cafe_id,
-- recomputes GST/discount/total, and writes the result straight back onto
-- orders/order_items — with no is_cafe_member() check, no role check,
-- nothing. It is `grant execute ... to authenticated` (0037:179, reaffirmed
-- 0123:522), which means it is reachable directly through Supabase's
-- auto-generated PostgREST RPC endpoint by ANY signed-up user on the whole
-- platform, not only from inside the order engines that call it internally.
--
-- Two concrete exploits this enabled:
--   1. A café's OWN waiter/cashier/kitchen account — already correctly capped
--      by staff_place_order's role-based discount ceiling — could bypass that
--      cap entirely by calling apply_order_taxes on their own café's order
--      with p_discount = the full subtotal, zeroing the bill with no
--      owner/manager check anywhere in the path.
--   2. Any authenticated user from Café A could rewrite Café B's order
--      totals/tax/discount if they obtained that order's UUID by any means
--      (a leaked receipt link, a screen-scrape, guessing) — directly
--      falsifying another café's revenue and GST records.
--
-- THE FIX
-- Not `if auth.uid() is not null` — that proves nothing about which café the
-- caller belongs to. The correct fix is architectural: this function has
-- EXACTLY ONE legitimate caller shape — an order engine (place_order,
-- staff_place_order, refund_order-family) that has ALREADY authorized the
-- request through its own entry point before ever reaching this helper.
-- place_order authorizes via a valid table token (and is itself SECURITY
-- DEFINER); staff_place_order authorizes via is_cafe_member + role/discount
-- cap; both, being SECURITY DEFINER, execute their entire body — including
-- every nested call to apply_order_taxes — AS THEIR OWNER, which is why
-- revoking `authenticated`'s direct grant does not break either of them.
--
-- Verified by grep across every migration (0037, 0038, 0047, 0056, 0061,
-- 0071, 0078, 0087, 0106, 0120, 0123, 0126) that apply_order_taxes is called
-- ONLY from inside other SECURITY DEFINER function bodies at the SQL level —
-- never once from application code. The one hit in components/pos/cart-panel.tsx
-- is a comment (written this session, describing the client-side tax
-- PREVIEW mirroring the server's logic) — not a call.
--
-- This is the exact pattern already proven safe one function above this one
-- in the same file: expand_combo_line is `revoke ... from public, anon,
-- authenticated` (0123:418) and stays perfectly callable from place_order and
-- staff_place_order, because a SECURITY DEFINER caller's internal calls run
-- as the function owner and are unaffected by what `authenticated` can or
-- cannot call directly. The team clearly knew this pattern — it simply was
-- never applied to apply_order_taxes across the ~9 migrations that touched
-- its body since 0037.
--
-- GST calculation is completely untouched: only the grant changes, not one
-- line of the function body.
-- ============================================================================

revoke execute on function apply_order_taxes(uuid, integer) from public, anon, authenticated;

-- Prove the fix rather than assert it: has_function_privilege reads the
-- actual grant state, no role-switch needed to check it.
do $$
begin
  if has_function_privilege('authenticated', 'apply_order_taxes(uuid, integer)', 'execute') then
    raise exception 'apply_order_taxes is still directly callable by authenticated — lockdown failed';
  end if;
  if has_function_privilege('anon', 'apply_order_taxes(uuid, integer)', 'execute') then
    raise exception 'apply_order_taxes is still directly callable by anon — lockdown failed';
  end if;
end $$;
