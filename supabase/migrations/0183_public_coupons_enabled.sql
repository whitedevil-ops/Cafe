-- ============================================================================
-- Full-audit finding, high, live-confirmed in production: the customer QR
-- checkout's "Have a coupon?" field renders unconditionally, regardless of
-- the café's plan entitlement. resolve_coupon_discount already correctly
-- rejects it server-side ("coupons are not available on this café's plan")
-- — but that raw message is exactly what a real customer sees, verified
-- live on khaopiyo.ventron.in against the real pilot café Brewora (starter
-- plan, coupons not entitled, 4 real active coupons that will always fail
-- for any customer who tries one).
--
-- cafe_has_feature() itself is correctly revoked from anon (security
-- boundary, confirmed by this same audit) — there is no existing anon-safe
-- way for the customer-facing page to know whether to show the field at
-- all. Mirrors the existing public_cafe_ordering_enabled() pattern
-- (0103_enforce_operating_hours.sql) exactly: override-then-plan-default,
-- resolved from a table token, granted to anon.
-- ============================================================================

create or replace function public_cafe_coupons_enabled(p_table_token text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_cafe_id  uuid;
  v_override boolean;
  v_plan_key text;
  v_features jsonb;
begin
  select cafe_id into v_cafe_id from cafe_tables where token = p_table_token;
  if v_cafe_id is null then return false; end if;

  select enabled into v_override from cafe_feature_overrides
    where cafe_id = v_cafe_id and feature_key = 'coupons';
  if v_override is not null then return v_override; end if;

  select plan into v_plan_key from cafes where id = v_cafe_id;
  select features into v_features from platform_plans where key = v_plan_key;
  return v_features is not null and coalesce((v_features ->> 'coupons')::boolean, false);
end $$;

revoke execute on function public_cafe_coupons_enabled(text) from public;
grant execute on function public_cafe_coupons_enabled(text) to anon, authenticated;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_proc where proname = 'public_cafe_coupons_enabled') <> 1 then
    raise exception 'public_cafe_coupons_enabled: expected exactly one overload';
  end if;
  if public_cafe_coupons_enabled('this-token-does-not-exist-audit-probe') is distinct from false then
    raise exception 'public_cafe_coupons_enabled did not return false for an unknown token';
  end if;
end $$;
