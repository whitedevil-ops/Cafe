-- ============================================================================
-- 0097 — Fixes a bug 0095 introduced: it recreated list_bills from the
-- stale 7-argument signature in 0039, not knowing 0042 had already added an
-- 8th argument (p_payment, the payment-status filter) and 0043 had already
-- had to clean up the exact same overload-ambiguity mistake once before.
-- `create or replace function` only replaces a function with an IDENTICAL
-- argument list, so 0095 created a SECOND overload instead of replacing the
-- payment-aware one — PGRST203 ("could not choose the best candidate
-- function"), the live Bills page broke. Caught by running check-schema-
-- style probes against prod after this migration batch ran, not by review.
--
-- Fix: drop the 7-argument overload 0095 created, and recreate the correct
-- 8-argument version with BOTH 0042's payment filter and 0095's actual-
-- settlement-method derivation (payments ledger, not orders.payment_method).
-- ============================================================================

drop function if exists list_bills(uuid, timestamptz, timestamptz, text, text, integer, integer);

create or replace function list_bills(
  p_cafe_id uuid,
  p_from    timestamptz,
  p_to      timestamptz,
  p_type    text default 'all',
  p_search  text default null,
  p_limit   integer default 100,
  p_offset  integer default 0,
  p_payment text default 'all'
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_rows    jsonb;
  v_summary jsonb;
  v_q       text;
begin
  if not is_cafe_member(p_cafe_id) then
    raise exception 'not authorized';
  end if;
  v_q := nullif(trim(coalesce(p_search, '')), '');

  with base as (
    select o.*, t.label as table_label, cu.name as customer_name,
           p.full_name as staff_name,
           coalesce((select sum(amount) from payments pay where pay.order_id = o.id), 0) as paid,
           coalesce((select sum(amount) from refunds r where r.order_id = o.id and r.status = 'completed'), 0) as refunded,
           (select case count(distinct pay.method)
              when 0 then null
              when 1 then min(pay.method::text)
              else 'split'
            end
            from payments pay where pay.order_id = o.id) as actual_method
      from orders o
      left join cafe_tables t on t.id = o.table_id
      left join customers cu on cu.id = o.customer_id
      left join profiles p on p.id = o.staff_id
     where o.cafe_id = p_cafe_id
       and o.created_at >= p_from and o.created_at < p_to
       and (p_type = 'all' or o.type::text = p_type)
       and (v_q is null
            or o.short_code ilike '%' || v_q || '%'
            or coalesce(o.gst_invoice_number, '') ilike '%' || v_q || '%'
            or coalesce(t.label, '') ilike '%' || v_q || '%'
            or coalesce(o.phone, '') ilike '%' || v_q || '%'
            or coalesce(cu.name, '') ilike '%' || v_q || '%')
  ),
  filtered as (
    select * from base b
    where p_payment = 'all'
       or (p_payment = 'refunded' and b.refunded > 0)
       or (p_payment = 'paid'     and b.status <> 'cancelled' and b.paid >= b.total and b.total > 0)
       or (p_payment = 'partial'  and b.status <> 'cancelled' and b.paid > 0 and b.paid < b.total)
       or (p_payment = 'unpaid'   and b.status <> 'cancelled' and b.paid = 0)
  )
  select
    jsonb_build_object(
      'count',    (select count(*) from filtered),
      'billed',   (select coalesce(sum(total), 0) from filtered where status <> 'cancelled'),
      'paid',     (select coalesce(sum(paid), 0) from filtered),
      'pending',  (select coalesce(sum(total - paid), 0) from filtered where status <> 'cancelled' and total > paid),
      'refunded', (select coalesce(sum(refunded), 0) from filtered)
    ),
    (select coalesce(jsonb_agg(row_to_json(x) order by x.created_at desc), '[]'::jsonb) from (
       select f.id, f.gst_invoice_number, f.short_code, f.created_at, f.type::text as order_type,
              f.table_label, f.customer_name, f.phone, f.total, f.paid, f.refunded,
              greatest(0, f.total - f.paid) as outstanding,
              coalesce(f.actual_method, f.payment_method::text) as payment_method,
              f.staff_name, f.receipt_token,
              case
                when f.status = 'cancelled' then 'CANCELLED'
                when f.refunded > 0 and f.refunded >= f.paid and f.paid > 0 then 'REFUNDED'
                when f.refunded > 0 then 'PARTIALLY_REFUNDED'
                when f.paid >= f.total and f.total > 0 then 'PAID'
                when f.paid > 0 then 'PARTIALLY_PAID'
                else 'UNPAID'
              end as bill_status
         from filtered f
        order by f.created_at desc
        limit greatest(1, least(coalesce(p_limit, 100), 500))
       offset greatest(0, coalesce(p_offset, 0))
     ) x)
  into v_summary, v_rows;

  return jsonb_build_object('summary', v_summary, 'bills', v_rows);
end $$;

revoke execute on function list_bills(uuid, timestamptz, timestamptz, text, text, integer, integer, text) from public, anon;
grant execute on function list_bills(uuid, timestamptz, timestamptz, text, text, integer, integer, text) to authenticated;
