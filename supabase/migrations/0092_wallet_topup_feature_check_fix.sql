-- ============================================================================
-- 0092 — Fix a real bug in wallet_start_topup (0091): it gated on
-- cafe_has_feature(v_cafe_id, 'wallet'), but cafe_has_feature fails closed
-- for anyone who isn't is_cafe_member() or is_platform_admin() — and
-- is_cafe_member() checks auth.uid(), which is NULL for an anonymous QR
-- customer session. So EVERY customer top-up attempt would have been
-- rejected with "not available at this café", even on a café whose plan
-- genuinely includes wallet. Caught before any real customer hit it (found
-- while building the customer-facing top-up UI, verified by re-reading
-- is_cafe_member's own definition rather than guessing).
--
-- Fix: inline the same override-then-plan-default precedence
-- cafe_has_feature itself uses, minus the membership gate — safe here
-- because the caller has already proven they're a real customer at this
-- café via customer_session_identity(p_session_token) a few lines above,
-- which is the actual authorization boundary for this function.
-- ============================================================================

create or replace function wallet_start_topup(p_session_token text, p_tier_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_customer_id    uuid;
  v_cafe_id        uuid;
  v_tier           wallet_topup_tiers%rowtype;
  v_attempt_id     uuid;
  v_override       boolean;
  v_plan_key       text;
  v_plan_features  jsonb;
  v_has_wallet     boolean;
begin
  select customer_id, cafe_id into v_customer_id, v_cafe_id
    from customer_session_identity(p_session_token);
  if v_customer_id is null then raise exception 'session expired — please log in again'; end if;

  select enabled into v_override from cafe_feature_overrides where cafe_id = v_cafe_id and feature_key = 'wallet';
  if v_override is not null then
    v_has_wallet := v_override;
  else
    select plan into v_plan_key from cafes where id = v_cafe_id;
    select features into v_plan_features from platform_plans where key = v_plan_key;
    v_has_wallet := coalesce((v_plan_features ->> 'wallet')::boolean, false);
  end if;
  if not v_has_wallet then
    raise exception 'wallet top-ups are not available at this café';
  end if;

  select * into v_tier from wallet_topup_tiers where id = p_tier_id and cafe_id = v_cafe_id and active;
  if v_tier.id is null then raise exception 'this top-up option is no longer available'; end if;

  insert into payment_attempts (cafe_id, customer_id, purpose, wallet_tier_id, amount, method, status)
  values (v_cafe_id, v_customer_id, 'wallet_topup', v_tier.id, v_tier.pay_amount, 'upi', 'initiated')
  returning id into v_attempt_id;

  return jsonb_build_object(
    'attempt_id', v_attempt_id, 'cafe_id', v_cafe_id,
    'pay_amount', v_tier.pay_amount, 'credit_amount', v_tier.credit_amount);
end $$;
grant execute on function wallet_start_topup(text, uuid) to anon, authenticated;
