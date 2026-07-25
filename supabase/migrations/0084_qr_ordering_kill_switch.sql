-- ============================================================================
-- 0084 — Real per-café QR ordering kill switch for platform-admin.
--
-- Suspend/Disable/Archive (op_set_cafe_status) already exists but is blunt:
-- it locks the ENTIRE dashboard for every staff member, not just customer
-- ordering. There was no way to pause just the customer-facing QR menu
-- (e.g. a café under fraud review) while staff keep working existing orders.
--
-- qr_ordering has been declared in platform_plans.features since 0019 with
-- every tier defaulting to true — it was never meant to be a paywalled
-- plan-tier feature (every café needs its own QR menu, full stop), just an
-- override an operator can flip per café. cafe_has_feature() can't be reused
-- here: it deliberately fails closed for anyone who isn't a member of the
-- café (anon customers never are), which would wrongly block ordering for
-- every café rather than only the ones an operator has actually paused.
-- This function skips that membership check — its only input is a table
-- token, which an anonymous caller can only have by having scanned that
-- café's own QR code, so there is no cross-tenant probing surface here the
-- way there would be if it took a bare cafe_id.
--
-- Fails OPEN (true) on any ambiguity — unknown token, missing plan row, or a
-- future feature key rename — so a lookup hiccup never takes a working
-- café's ordering offline. Only an explicit override=false or
-- features->>'qr_ordering'=false actually pauses it.
-- ============================================================================

create or replace function public_cafe_ordering_enabled(p_table_token text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_cafe_id  uuid;
  v_override boolean;
  v_plan_key text;
  v_features jsonb;
begin
  select cafe_id into v_cafe_id from cafe_tables where token = p_table_token;
  if v_cafe_id is null then return true; end if;

  select enabled into v_override from cafe_feature_overrides
    where cafe_id = v_cafe_id and feature_key = 'qr_ordering';
  if v_override is not null then return v_override; end if;

  select plan into v_plan_key from cafes where id = v_cafe_id;
  select features into v_features from platform_plans where key = v_plan_key;
  if v_features is null then return true; end if;
  return coalesce((v_features ->> 'qr_ordering')::boolean, true);
end $$;

revoke execute on function public_cafe_ordering_enabled(text) from public;
grant execute on function public_cafe_ordering_enabled(text) to anon, authenticated;
