-- ============================================================================
-- 0138 — CRITICAL: resolve_coupon_discount had zero authorization check and
--        was directly callable by any authenticated user with any café's ID,
--        disclosing that café's active coupon codes, values and rules.
--
-- CONFIRMED BY A 12-AGENT AUDIT WITH INDEPENDENT ADVERSARIAL RE-VERIFICATION.
--
-- resolve_coupon_discount(p_cafe_id, p_code, ...) looks up
-- `coupons where cafe_id = p_cafe_id and upper(code) = upper(trim(p_code))`
-- with no check that the caller is a member of p_cafe_id. It is
-- `grant execute ... to authenticated` (0078:111), reachable directly through
-- Supabase's PostgREST RPC endpoint. Contrast with every sibling function in
-- this exact file: validate_coupon checks is_cafe_member(p_cafe_id), so does
-- list_applicable_coupons; create_coupon and set_coupon_categories resolve
-- the café from the target record and check role. resolve_coupon_discount
-- alone was left unguarded — an oversight, not a deliberate design, since the
-- other seven coupon functions in this file all got it right.
--
-- Impact was read-only data exposure (coupon codes/values/min-order across
-- tenant boundaries), not fund movement — the function can't spend money on
-- its own — but it's an unambiguous cross-café reachability gap.
--
-- THE FIX
-- Same architecture as 0137's apply_order_taxes fix, because the shape of the
-- problem is identical: this is a shared internal helper, not a real API
-- surface. Grepped every caller across the whole codebase — resolve_coupon_
-- discount is called ONLY from within other SECURITY DEFINER functions that
-- have ALREADY authorized the request before reaching it:
--   validate_coupon        -- checks is_cafe_member(p_cafe_id) first
--   validate_coupon_public -- resolves cafe_id from a table token, not a param
--   place_order / staff_place_order (every historical redefinition)
-- It is never called from application code (grepped app/, lib/, components/
-- for the literal name — zero hits outside SQL). Revoking authenticated
-- entirely does not break any of the above: a SECURITY DEFINER caller's
-- internal calls execute as the function's owner and are unaffected by what
-- `authenticated` can call directly — the same fact that already lets
-- expand_combo_line (0123:418) and, as of 0137, apply_order_taxes stay
-- perfectly callable internally while being unreachable from outside.
-- ============================================================================

revoke execute on function resolve_coupon_discount(uuid, text, integer, uuid, uuid[]) from public, anon, authenticated;

do $$
begin
  if has_function_privilege('authenticated', 'resolve_coupon_discount(uuid, text, integer, uuid, uuid[])', 'execute') then
    raise exception 'resolve_coupon_discount is still directly callable by authenticated — lockdown failed';
  end if;
  if has_function_privilege('anon', 'resolve_coupon_discount(uuid, text, integer, uuid, uuid[])', 'execute') then
    raise exception 'resolve_coupon_discount is still directly callable by anon — lockdown failed';
  end if;
end $$;

-- ============================================================================
-- Audited the rest of the coupon-function family in the same pass (0061,
-- 0062, 0077, 0078 — every function whose name mentions "coupon"). All eight
-- others are correctly authorized and needed no change:
--   validate_coupon         is_cafe_member(p_cafe_id)                     0078:127
--   validate_coupon_public  cafe_id resolved from table token, not a param 0078:155
--   list_applicable_coupons is_cafe_member(p_cafe_id)                     0078:184
--   set_coupon_categories   role resolved from the coupon's OWN cafe_id    0078:233-236
--   create_coupon           role resolved from cafe_members, owner/manager 0078:274-278
--   coupon_stats            is_cafe_member(p_cafe_id)                     0061:622
--   set_coupon_active       role resolved from the coupon's OWN cafe_id    0062:90-96
-- ============================================================================
