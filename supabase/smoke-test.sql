-- ============================================================================
-- SMOKE TEST — run after every migration, alongside check-schema.sql.
--
-- WHY THIS EXISTS: check-schema.sql only proves an object EXISTS. plpgsql
-- resolves column/variable ambiguity at RUNTIME, so a function with a fatal
-- `column reference is ambiguous` bug still creates successfully and still
-- reports present = true. That is exactly how a broken compute_bill() shipped
-- to production in 0016 and silently broke every QR and POS order until
-- someone tried to place one.
--
-- This file actually CALLS the read-only functions. Read-only only — nothing
-- here writes an order, payment, or status change.
-- ============================================================================

-- ── compute_bill (used by BOTH place_order and staff_place_order) ──────────
do $$
declare
  v_cafe uuid;
  v_row  record;
begin
  select id into v_cafe from cafes order by created_at limit 1;
  if v_cafe is null then
    raise notice 'SKIP compute_bill — no cafés exist yet';
    return;
  end if;

  select * into v_row from compute_bill(v_cafe, 1000, 100);
  raise notice 'PASS compute_bill — subtotal 1000, discount 100 -> base %, tax %, svc %, total %',
    v_row.discounted_subtotal, v_row.tax, v_row.service_charge, v_row.total;

  -- Zero-discount path (what the QR flow always uses).
  select * into v_row from compute_bill(v_cafe, 500, 0);
  raise notice 'PASS compute_bill — subtotal 500, no discount -> total %', v_row.total;
exception when others then
  raise warning 'FAIL compute_bill — %', sqlerrm;
end $$;

-- ── cafe_has_feature ───────────────────────────────────────────────────────
do $$
declare v_cafe uuid; v_result boolean;
begin
  select id into v_cafe from cafes order by created_at limit 1;
  if v_cafe is null then raise notice 'SKIP cafe_has_feature — no cafés'; return; end if;
  -- Returns false here because the SQL editor has no auth.uid(); we are
  -- checking that it EXECUTES, not what it answers.
  select cafe_has_feature(v_cafe, 'crm') into v_result;
  raise notice 'PASS cafe_has_feature — executed, returned %', v_result;
exception when others then
  raise warning 'FAIL cafe_has_feature — %', sqlerrm;
end $$;

-- ── v_customer_stats / v_cafe_onboarding views ─────────────────────────────
do $$
declare v_n integer;
begin
  select count(*) into v_n from v_customer_stats;
  raise notice 'PASS v_customer_stats — % row(s)', v_n;
exception when others then
  raise warning 'FAIL v_customer_stats — %', sqlerrm;
end $$;

do $$
declare v_n integer;
begin
  select count(*) into v_n from v_cafe_onboarding;
  raise notice 'PASS v_cafe_onboarding — % row(s)', v_n;
exception when others then
  raise warning 'FAIL v_cafe_onboarding — %', sqlerrm;
end $$;

-- ── Operator functions ──────────────────────────────────────────────────────
-- These call is_platform_admin(), which reads auth.uid(). In the SQL editor
-- auth.uid() is NULL, so they correctly refuse. To smoke-test them properly,
-- impersonate your operator account for the duration of one transaction:
--
--   begin;
--     select set_config('request.jwt.claims',
--       json_build_object('sub', (select user_id from platform_admins limit 1))::text, true);
--     select op_platform_overview();
--     select count(*) from op_list_cafes();
--     select count(*) from op_cafe_health();
--   rollback;
--
-- A `not authorized` error means the gate works. A `column reference is
-- ambiguous` error means the function is broken — that is the failure mode
-- this file exists to catch.
