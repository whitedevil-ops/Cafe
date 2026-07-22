-- ============================================================================
-- SMOKE TEST — run after every migration, alongside check-schema.sql.
-- Read-only: nothing here writes an order, payment, or status change.
--
-- WHY THIS EXISTS: check-schema.sql only proves an object EXISTS. plpgsql
-- resolves column/variable ambiguity at RUNTIME, so a function with a fatal
-- `column reference is ambiguous` bug still creates successfully and still
-- reports present = true. That is exactly how a broken compute_bill() shipped
-- in 0016 and silently broke every QR and POS order until someone placed one.
--
-- Returns a normal results table. Every row should read PASS (or SKIP if the
-- database has no cafés yet). Any FAIL row includes the real Postgres error.
-- ============================================================================

do $$
declare
  v_cafe uuid;
  v_row  record;
  v_bool boolean;
  v_n    integer;
begin
  create temp table if not exists smoke_results (
    seq serial, check_name text, status text, detail text
  ) on commit drop;
  delete from smoke_results;

  select id into v_cafe from cafes order by created_at limit 1;

  -- compute_bill — called by BOTH place_order (QR) and staff_place_order (POS).
  if v_cafe is null then
    insert into smoke_results (check_name, status, detail)
    values ('compute_bill', 'SKIP', 'no cafés exist yet');
  else
    begin
      select * into v_row from compute_bill(v_cafe, 1000, 100);
      insert into smoke_results (check_name, status, detail)
      values ('compute_bill (discounted)', 'PASS',
        format('subtotal 1000 less 100 -> base %s, tax %s, svc %s, total %s',
               v_row.discounted_subtotal, v_row.tax, v_row.service_charge, v_row.total));
    exception when others then
      insert into smoke_results (check_name, status, detail)
      values ('compute_bill (discounted)', 'FAIL', sqlerrm);
    end;

    begin
      select * into v_row from compute_bill(v_cafe, 500, 0);
      insert into smoke_results (check_name, status, detail)
      values ('compute_bill (no discount)', 'PASS', format('subtotal 500 -> total %s', v_row.total));
    exception when others then
      insert into smoke_results (check_name, status, detail)
      values ('compute_bill (no discount)', 'FAIL', sqlerrm);
    end;

    begin
      select cafe_has_feature(v_cafe, 'crm') into v_bool;
      insert into smoke_results (check_name, status, detail)
      values ('cafe_has_feature', 'PASS',
        format('executed, returned %s (false is expected here — SQL editor has no auth.uid())', v_bool));
    exception when others then
      insert into smoke_results (check_name, status, detail)
      values ('cafe_has_feature', 'FAIL', sqlerrm);
    end;
  end if;

  begin
    select count(*) into v_n from v_customer_stats;
    insert into smoke_results (check_name, status, detail)
    values ('v_customer_stats', 'PASS', format('%s row(s)', v_n));
  exception when others then
    insert into smoke_results (check_name, status, detail)
    values ('v_customer_stats', 'FAIL', sqlerrm);
  end;

  begin
    select count(*) into v_n from v_cafe_onboarding;
    insert into smoke_results (check_name, status, detail)
    values ('v_cafe_onboarding', 'PASS', format('%s row(s)', v_n));
  exception when others then
    insert into smoke_results (check_name, status, detail)
    values ('v_cafe_onboarding', 'FAIL', sqlerrm);
  end;

  -- Operator functions: is_platform_admin() reads auth.uid(), which is NULL in
  -- the SQL editor, so these SHOULD refuse. 'not authorized' proves the gate
  -- works; 'column reference is ambiguous' would mean the function is broken.
  begin
    perform op_platform_overview();
    insert into smoke_results (check_name, status, detail)
    values ('op_platform_overview', 'PASS', 'executed (ran as an admin context)');
  exception when others then
    insert into smoke_results (check_name, status, detail)
    values ('op_platform_overview',
            case when sqlerrm ilike '%not authorized%' then 'PASS' else 'FAIL' end,
            sqlerrm);
  end;

  begin
    perform count(*) from op_cafe_health();
    insert into smoke_results (check_name, status, detail)
    values ('op_cafe_health', 'PASS', 'executed (ran as an admin context)');
  exception when others then
    insert into smoke_results (check_name, status, detail)
    values ('op_cafe_health',
            case when sqlerrm ilike '%not authorized%' then 'PASS' else 'FAIL' end,
            sqlerrm);
  end;

  begin
    perform count(*) from op_list_cafes();
    insert into smoke_results (check_name, status, detail)
    values ('op_list_cafes', 'PASS', 'executed (ran as an admin context)');
  exception when others then
    insert into smoke_results (check_name, status, detail)
    values ('op_list_cafes',
            case when sqlerrm ilike '%not authorized%' then 'PASS' else 'FAIL' end,
            sqlerrm);
  end;
end $$;

select check_name, status, detail from smoke_results order by seq;
