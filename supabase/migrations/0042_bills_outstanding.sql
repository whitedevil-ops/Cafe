-- ============================================================================
-- 0042 — Payment-aware Bills filtering + an outstanding summary for the
-- owner dashboard. Extends list_bills (0039) rather than forking it, and
-- keeps every figure server-computed from confirmed payments and refunds.
-- ============================================================================

-- list_bills gains a payment filter and exposes per-bill outstanding.
-- p_payment: all | paid | partial | unpaid | refunded. The new parameter has
-- a default, so the existing 7-argument callers keep working unchanged.
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
           coalesce((select sum(amount) from refunds r where r.order_id = o.id and r.status = 'completed'), 0) as refunded
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
              f.payment_method::text as payment_method, f.staff_name, f.receipt_token,
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

-- ── outstanding_summary: the money view for the owner dashboard ────────────
-- collected = payments received in range; outstanding = unpaid balance on
-- non-cancelled orders in range; refunded = completed refunds in range.
-- Unpaid sales are NEVER counted as collected cash (spec §14).
create or replace function outstanding_summary(p_cafe_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_collected integer;
  v_refunded  integer;
  v_out       integer;
  v_orders    integer;
  v_tables    integer;
begin
  if not is_cafe_member(p_cafe_id) then raise exception 'not authorized'; end if;

  select coalesce(sum(amount), 0) into v_collected
    from payments where cafe_id = p_cafe_id and created_at >= p_from and created_at < p_to;

  select coalesce(sum(amount), 0) into v_refunded
    from refunds where cafe_id = p_cafe_id and status = 'completed'
      and created_at >= p_from and created_at < p_to;

  with unpaid as (
    select o.id, o.table_id, greatest(0, o.total - coalesce((select sum(amount) from payments p where p.order_id = o.id), 0)) as due
      from orders o
     where o.cafe_id = p_cafe_id and o.status <> 'cancelled'
       and o.created_at >= p_from and o.created_at < p_to
  )
  select coalesce(sum(due), 0), count(*) filter (where due > 0), count(distinct table_id) filter (where due > 0 and table_id is not null)
    into v_out, v_orders, v_tables from unpaid;

  return jsonb_build_object(
    'collected', v_collected, 'refunded', v_refunded,
    'outstanding', v_out, 'unpaid_orders', v_orders, 'unpaid_tables', v_tables);
end $$;

revoke execute on function outstanding_summary(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function outstanding_summary(uuid, timestamptz, timestamptz) to authenticated;
