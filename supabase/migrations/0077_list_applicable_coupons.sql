-- ============================================================================
-- 0077 — POS request: tapping the coupon field should suggest which coupons
-- are actually usable right now, instead of staff needing to already know
-- the code. Mirrors resolve_coupon_discount's exact eligibility checks
-- (active, date window, min_order, usage_limit, per_customer) so a coupon
-- shown here is guaranteed to actually apply when tapped — no drift between
-- "suggested" and "would validate."
-- ============================================================================

create or replace function list_applicable_coupons(
  p_cafe_id        uuid,
  p_subtotal       integer,
  p_customer_phone text default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_phone       text;
  v_customer_id uuid;
  v_result      jsonb;
begin
  if not is_cafe_member(p_cafe_id) then
    raise exception 'not authorized for this café';
  end if;

  v_phone := nullif(regexp_replace(coalesce(p_customer_phone, ''), '\D', '', 'g'), '');
  if v_phone is not null then
    select id into v_customer_id from customers where cafe_id = p_cafe_id and phone = v_phone;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'code', c.code, 'name', c.name, 'kind', c.kind, 'value', c.value,
    'discount', case when c.kind = 'percent'
      then least(round(p_subtotal * least(greatest(c.value, 0), 100) / 100.0), coalesce(c.max_discount, 2147483647))
      else least(c.value, p_subtotal) end
  ) order by c.created_at desc), '[]'::jsonb)
  into v_result
  from coupons c
  where c.cafe_id = p_cafe_id
    and c.active
    and c.kind in ('percent', 'flat')
    and (c.starts_at is null or now() >= c.starts_at)
    and (c.ends_at is null or now() <= c.ends_at)
    and p_subtotal >= c.min_order
    and (c.usage_limit is null or
         (select count(*) from coupon_redemptions cr where cr.coupon_id = c.id) < c.usage_limit)
    and (c.per_customer is null or v_customer_id is null or
         (select count(*) from coupon_redemptions cr where cr.coupon_id = c.id and cr.customer_id = v_customer_id) < c.per_customer);

  return v_result;
end $$;

revoke execute on function list_applicable_coupons(uuid, integer, text) from public, anon;
grant execute on function list_applicable_coupons(uuid, integer, text) to authenticated;
