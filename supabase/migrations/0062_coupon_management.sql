-- ============================================================================
-- 0062 — Coupon management: create + activate/deactivate.
--
-- coupons/coupon_redemptions were locked to read-only for café members by
-- 0050 (F-01 lockdown) — correctly, since a coupon is a direct financial
-- lever. There was simply no RPC yet for the mutation side. Restricted to
-- owner/manager, mirroring the same role gate staff_place_order already
-- uses for discretionary discounts (a coupon is exactly that, pre-agreed).
--
-- Only 'percent' and 'flat' can be CREATED here, matching 0061's redemption
-- engine — creating a 'bogo'/'free_item'/'min_order' coupon through this UI
-- would produce one nothing in this codebase can actually redeem.
-- ============================================================================

create or replace function create_coupon(
  p_cafe_id      uuid,
  p_code         text,
  p_name         text,
  p_kind         text,
  p_value        integer,
  p_min_order    integer default 0,
  p_max_discount integer default null,
  p_starts_at    timestamptz default null,
  p_ends_at      timestamptz default null,
  p_usage_limit  integer default null,
  p_per_customer integer default null
) returns coupons
language plpgsql security definer set search_path = public as $$
declare
  v_role member_role;
  v_code text;
  v_row  coupons%rowtype;
begin
  select role into v_role from cafe_members where cafe_id = p_cafe_id and user_id = auth.uid();
  if v_role is null then raise exception 'not authorized for this café'; end if;
  if v_role not in ('owner', 'manager') then
    raise exception 'only an owner or manager can create coupons';
  end if;

  v_code := upper(trim(coalesce(p_code, '')));
  if v_code = '' then raise exception 'enter a coupon code'; end if;
  if p_kind not in ('percent', 'flat') then
    raise exception 'only percent or flat coupons are supported';
  end if;
  if p_kind = 'percent' and (p_value <= 0 or p_value > 100) then
    raise exception 'a percent coupon needs a value between 1 and 100';
  end if;
  if p_kind = 'flat' and p_value <= 0 then
    raise exception 'a flat coupon needs a value greater than 0';
  end if;
  if coalesce(p_min_order, 0) < 0 then raise exception 'minimum order cannot be negative'; end if;
  if p_max_discount is not null and p_max_discount <= 0 then
    raise exception 'maximum discount must be greater than 0';
  end if;
  if p_starts_at is not null and p_ends_at is not null and p_ends_at <= p_starts_at then
    raise exception 'end date must be after the start date';
  end if;
  if p_usage_limit is not null and p_usage_limit <= 0 then
    raise exception 'usage limit must be greater than 0';
  end if;
  if p_per_customer is not null and p_per_customer <= 0 then
    raise exception 'per-customer limit must be greater than 0';
  end if;

  insert into coupons (cafe_id, code, name, kind, value, min_order, max_discount,
                        starts_at, ends_at, usage_limit, per_customer)
  values (p_cafe_id, v_code, nullif(trim(coalesce(p_name, '')), ''), p_kind::coupon_kind, p_value,
          coalesce(p_min_order, 0), p_max_discount, p_starts_at, p_ends_at, p_usage_limit, p_per_customer)
  returning * into v_row;

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (p_cafe_id, auth.uid(), 'coupon.created', 'coupons', v_row.id,
          jsonb_build_object('code', v_row.code, 'kind', v_row.kind, 'value', v_row.value));

  return v_row;
exception
  when unique_violation then
    raise exception 'a coupon with code "%" already exists', v_code;
end $$;

revoke execute on function create_coupon(uuid, text, text, text, integer, integer, integer, timestamptz, timestamptz, integer, integer) from public, anon;
grant execute on function create_coupon(uuid, text, text, text, integer, integer, integer, timestamptz, timestamptz, integer, integer) to authenticated;

create or replace function set_coupon_active(p_coupon_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id uuid;
  v_role    member_role;
begin
  select cafe_id into v_cafe_id from coupons where id = p_coupon_id;
  if v_cafe_id is null then raise exception 'coupon not found'; end if;

  select role into v_role from cafe_members where cafe_id = v_cafe_id and user_id = auth.uid();
  if v_role is null then raise exception 'not authorized for this café'; end if;
  if v_role not in ('owner', 'manager') then
    raise exception 'only an owner or manager can change a coupon''s status';
  end if;

  update coupons set active = p_active where id = p_coupon_id;

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (v_cafe_id, auth.uid(), 'coupon.status_changed', 'coupons', p_coupon_id,
          jsonb_build_object('active', p_active));
end $$;

revoke execute on function set_coupon_active(uuid, boolean) from public, anon;
grant execute on function set_coupon_active(uuid, boolean) to authenticated;
