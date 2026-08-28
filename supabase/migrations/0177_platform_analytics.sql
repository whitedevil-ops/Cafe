-- ============================================================================
-- Phase 5 (real-data-only portion) — Platform Analytics: orders-by-source
-- and payment-method-mix, aggregated across every café. This is deliberately
-- NOT revenue/MRR/churn/billing analytics -- platform_billing_events has 0
-- rows and every café's billing_status is 'none' (confirmed earlier this
-- session), so any MRR/churn number here would be fabricated. What's built
-- instead is real, already-happened money: orders actually placed and
-- payments actually collected, not projected recurring revenue.
--
-- Gated on the EXISTING 'subscriptions.view' permission key, not a new one
-- -- sidesteps the 3-way role_default_permissions / op_update_admin_permissions
-- / op_create_admin migration-collision risk (documented repeatedly in this
-- repo's own history) for a page that doesn't need a new permission concept.
-- Per current role_default_permissions(): super_admin, operations_admin,
-- billing_admin, and read_only already hold subscriptions.view=true;
-- support_admin and sales_admin don't -- exactly the right boundary for
-- revenue-adjacent data.
--
-- Deliberately does NOT exclude cafes.is_demo -- no existing platform-wide
-- aggregate in this codebase (op_platform_overview's total_orders, etc.)
-- excludes it either; diverging here would be a new, silent inconsistency,
-- not a fix.
--
-- Deliberately does NOT net refunds out of payment_method_mix -- mirrors
-- payments_outstanding_report (0099_wallet_topups_in_reports.sql) exactly,
-- which reports gross collected-by-method and keeps refunds a separate,
-- additive figure everywhere else in this codebase (0028_refunds.sql's own
-- comment: "net = sum(payments) - sum(refunds), computed elsewhere").
-- ============================================================================

create or replace function op_platform_analytics(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_from timestamptz := coalesce(p_from, '2000-01-01'::timestamptz);
  v_to timestamptz := coalesce(p_to, now() + interval '1 day');
begin
  if not has_platform_permission('subscriptions.view') then raise exception 'not authorized'; end if;

  return jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'orders_by_source', (
      select coalesce(jsonb_agg(jsonb_build_object('source', o.source, 'orders', o.cnt, 'revenue', o.rev) order by o.rev desc), '[]'::jsonb)
      from (
        select source::text as source, count(*) as cnt, coalesce(sum(total), 0) as rev
        from orders
        where status <> 'cancelled' and created_at >= v_from and created_at < v_to
        group by 1
      ) o
    ),
    'payment_method_mix', (
      select coalesce(jsonb_agg(jsonb_build_object('method', p.method, 'amount', p.amt, 'transactions', p.cnt) order by p.amt desc), '[]'::jsonb)
      from (
        select method::text as method, sum(amount) as amt, count(*) as cnt
        from payments
        where created_at >= v_from and created_at < v_to
        group by 1
      ) p
    )
  );
end $$;

revoke all on function op_platform_analytics(timestamptz, timestamptz) from public, anon;
grant execute on function op_platform_analytics(timestamptz, timestamptz) to authenticated;

-- ── self-check: prove it parses and reaches the permission gate. Migrations
-- run with no auth.uid(), so 'not authorized' is the expected outcome. ─────
do $$
begin
  begin perform op_platform_analytics();
  exception
    when others then
      if sqlerrm not like '%not authorized%' then raise; end if;
  end;
end $$;
