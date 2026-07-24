-- ============================================================================
-- 0048 — Fix the enum cast that silently broke every payment.
--
-- recompute_order_payment_status (0041) set payment_status from a CASE whose
-- branches are all bare string literals. In PostgreSQL a CASE of all-unknown
-- literals resolves to TEXT, and there is NO implicit assignment cast from
-- text to an enum — so the UPDATE raised:
--
--   column "payment_status" is of type payment_status but expression is of type text
--
-- record_payment calls this at the end of EVERY payment, so the error rolled
-- back the whole transaction: no payment was ever recorded, and every order
-- stayed "unpaid" no matter how it was settled. This is the true source of the
-- "everything shows unpaid" behaviour. The paths only appeared to work because
-- nothing exercised a real settle to completion (the smoke test asserts the
-- fail-closed authorization path, never the UPDATE).
--
-- Fix: cast each branch to payment_status so the CASE is the enum type and the
-- assignment is exact. Body is otherwise identical to 0041.
-- ============================================================================

create or replace function recompute_order_payment_status(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_o record; v_paid integer;
begin
  select status, payment_status, total into v_o from orders where id = p_order_id;
  if not found then return; end if;
  if v_o.status = 'cancelled' or v_o.payment_status = 'refunded' then return; end if;

  select coalesce(sum(amount), 0) into v_paid from payments where order_id = p_order_id;

  update orders set payment_status =
    case when v_o.total > 0 and v_paid >= v_o.total then 'paid'::payment_status
         when v_paid > 0 then 'partial'::payment_status
         else 'unpaid'::payment_status end
  where id = p_order_id;
end $$;
revoke execute on function recompute_order_payment_status(uuid) from public, anon;
grant execute on function recompute_order_payment_status(uuid) to authenticated;
