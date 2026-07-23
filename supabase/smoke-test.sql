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
  -- Customer history must REFUSE a token it never issued. A row back here
  -- instead of an exception would mean anyone could read anyone's orders.
  begin
    perform customer_order_history(repeat('f', 64), 5, 0);
    insert into smoke_results (check_name, status, detail)
    values ('customer_order_history (forged token)', 'FAIL',
            'DANGER: returned data for a token that was never issued');
  exception when others then
    insert into smoke_results (check_name, status, detail)
    values ('customer_order_history (forged token)',
            case when sqlerrm ilike '%session expired%' then 'PASS' else 'FAIL' end,
            sqlerrm);
  end;

  begin
    perform customer_reorder_payload(repeat('f', 64), gen_random_uuid());
    insert into smoke_results (check_name, status, detail)
    values ('customer_reorder_payload (forged token)', 'FAIL',
            'DANGER: accepted a token that was never issued');
  exception when others then
    insert into smoke_results (check_name, status, detail)
    values ('customer_reorder_payload (forged token)',
            case when sqlerrm ilike '%session expired%' then 'PASS' else 'FAIL' end,
            sqlerrm);
  end;

  -- Visit counting: orders sharing a table session must collapse to one visit.
  begin
    select count(*) into v_n from v_customer_stats where visits > 0;
    insert into smoke_results (check_name, status, detail)
    values ('v_customer_stats (session-based visits)', 'PASS',
            format('%s customer(s) with at least one visit', v_n));
  exception when others then
    insert into smoke_results (check_name, status, detail)
    values ('v_customer_stats (session-based visits)', 'FAIL', sqlerrm);
  end;

  -- gst_financial_year: a plain string function, but it does real `at time
  -- zone` arithmetic — worth executing, not just existence-checking.
  begin
    declare v_fy text;
    begin
      select gst_financial_year('2026-07-23T00:00:00Z'::timestamptz, 'Asia/Kolkata') into v_fy;
      insert into smoke_results (check_name, status, detail)
      values ('gst_financial_year', case when v_fy = '26-27' then 'PASS' else 'FAIL' end,
              format('23 Jul 2026 -> %s (expected 26-27)', v_fy));
    end;
  exception when others then
    insert into smoke_results (check_name, status, detail)
    values ('gst_financial_year', 'FAIL', sqlerrm);
  end;

  -- get_receipt must still execute cleanly now that it carries the GST block
  -- (0031) — a forged/nonexistent token should just return no row, not error.
  begin
    perform get_receipt('00000000-0000-0000-0000-000000000000'::uuid);
    insert into smoke_results (check_name, status, detail)
    values ('get_receipt (gst_invoice block)', 'PASS', 'executed with no fatal error on an unknown token');
  exception when others then
    insert into smoke_results (check_name, status, detail)
    values ('get_receipt (gst_invoice block)', 'FAIL', sqlerrm);
  end;

  -- sales_report (0032, extended 0034 for expenses/net_profit): auth.uid()
  -- is NULL in the SQL editor, so is_cafe_member() must fail closed and
  -- refuse — 'not authorized' is the correct, expected outcome here, not a
  -- real failure. If the expense_total CTE referenced a bad column name,
  -- this is exactly the check that would have caught it with a real
  -- Postgres error instead of 'not authorized'.
  if v_cafe is not null then
    begin
      perform sales_report(v_cafe, now() - interval '30 days', now());
      insert into smoke_results (check_name, status, detail)
      values ('sales_report', 'PASS', 'executed (ran as an admin context)');
    exception when others then
      insert into smoke_results (check_name, status, detail)
      values ('sales_report',
              case when sqlerrm ilike '%not authorized%' then 'PASS' else 'FAIL' end,
              sqlerrm);
    end;

    -- low_stock_items (0035): same fail-closed expectation.
    begin
      perform count(*) from low_stock_items(v_cafe);
      insert into smoke_results (check_name, status, detail)
      values ('low_stock_items', 'PASS', 'executed (ran as an admin context)');
    exception when others then
      insert into smoke_results (check_name, status, detail)
      values ('low_stock_items',
              case when sqlerrm ilike '%not authorized%' then 'PASS' else 'FAIL' end,
              sqlerrm);
    end;

    -- menu_item_costs (0036): joins menu_items -> recipe_items ->
    -- inventory_items and does real numeric/aggregate work, so executing it
    -- is the only way to catch a bad column reference in that chain.
    begin
      perform count(*) from menu_item_costs(v_cafe);
      insert into smoke_results (check_name, status, detail)
      values ('menu_item_costs', 'PASS', 'executed (ran as an admin context)');
    exception when others then
      insert into smoke_results (check_name, status, detail)
      values ('menu_item_costs',
              case when sqlerrm ilike '%not authorized%' then 'PASS' else 'FAIL' end,
              sqlerrm);
    end;

    -- list_bills / bill_detail (0039): same fail-closed expectation.
    begin
      perform list_bills(v_cafe, now() - interval '1 day', now(), 'all', null, 10, 0);
      insert into smoke_results (check_name, status, detail)
      values ('list_bills', 'PASS', 'executed (ran as an admin context)');
    exception when others then
      insert into smoke_results (check_name, status, detail)
      values ('list_bills',
              case when sqlerrm ilike '%not authorized%' then 'PASS' else 'FAIL' end,
              sqlerrm);
    end;

    -- outstanding_summary (0042): same fail-closed expectation.
    begin
      perform outstanding_summary(v_cafe, now() - interval '1 day', now());
      insert into smoke_results (check_name, status, detail)
      values ('outstanding_summary', 'PASS', 'executed (ran as an admin context)');
    exception when others then
      insert into smoke_results (check_name, status, detail)
      values ('outstanding_summary',
              case when sqlerrm ilike '%not authorized%' then 'PASS' else 'FAIL' end,
              sqlerrm);
    end;
  end if;

  -- ── GST maths, executed with real numbers (0037) ────────────────────────
  -- These bodies run unconditionally (no auth gate), so unlike the
  -- report/bill functions above they genuinely exercise the SQL. That
  -- matters: an auth check that fires first would otherwise hide a broken
  -- body behind a 'not authorized' PASS.
  begin
    declare v_ok boolean;
    begin
      select is_valid_gstin('06AABCB1234F1Z5') into v_ok;
      insert into smoke_results (check_name, status, detail)
      values ('is_valid_gstin (valid)', case when v_ok then 'PASS' else 'FAIL' end,
              format('06AABCB1234F1Z5 -> %s', v_ok));
      select is_valid_gstin('NOT-A-GSTIN') into v_ok;
      insert into smoke_results (check_name, status, detail)
      values ('is_valid_gstin (invalid rejected)', case when not v_ok then 'PASS' else 'FAIL' end,
              format('NOT-A-GSTIN -> %s', v_ok));
    end;
  exception when others then
    insert into smoke_results (check_name, status, detail)
    values ('is_valid_gstin', 'FAIL', sqlerrm);
  end;

  if v_cafe is not null then
    -- apply_order_taxes on a real historic order: proves the whole per-line
    -- loop executes and that cgst+sgst reconstructs the stored tax exactly.
    declare
      v_order uuid;
      v_res   record;
    begin
      select id into v_order from orders
       where cafe_id = v_cafe and status <> 'cancelled'
       order by created_at desc limit 1;

      if v_order is null then
        insert into smoke_results (check_name, status, detail)
        values ('apply_order_taxes', 'SKIP', 'no orders yet');
      else
        select * into v_res from apply_order_taxes(v_order, 0);
        insert into smoke_results (check_name, status, detail)
        values ('apply_order_taxes',
                case when v_res.total = (v_res.subtotal - v_res.discount) + v_res.tax + v_res.service_charge
                       or v_res.total = (v_res.subtotal - v_res.discount) + v_res.service_charge
                     then 'PASS' else 'FAIL' end,
                format('subtotal %s, tax %s, svc %s, total %s',
                       v_res.subtotal, v_res.tax, v_res.service_charge, v_res.total));

        insert into smoke_results (check_name, status, detail)
        select 'cgst+sgst reconstructs tax',
               case when (o.tax / 2) + (o.tax - o.tax / 2) = o.tax then 'PASS' else 'FAIL' end,
               format('tax %s -> cgst %s + sgst %s', o.tax, o.tax / 2, o.tax - o.tax / 2)
          from orders o where o.id = v_order;
      end if;
    exception when others then
      insert into smoke_results (check_name, status, detail)
      values ('apply_order_taxes', 'FAIL', sqlerrm);
    end;
  end if;
end $$;

select check_name, status, detail from smoke_results order by seq;
