-- ============================================================================
-- 0234 — Batch 2 of the ungated-features entitlement project: discounts,
-- order cancellation, refunds, split payments, cash-shift opening.
--
-- All five keys were seeded true on every plan by 0233, already confirmed
-- live before this migration runs (see that file's own header — this one
-- must not ship before that one is confirmed, or every one of these checks
-- resolves to false for every café the moment it deploys).
--
-- staff_place_order and refund_order are large, long-lived functions —
-- restating either from scratch risks exactly the silent-revert failure
-- mode 0203/0227 already hit once this project (copying several hundred
-- lines forward to change one of them is how an unrelated fix gets
-- silently reverted the next time someone touches the function). Both are
-- patched via the same live regex-replace technique 0203/0227 established:
-- fetch the current body, replace one small, uniquely-matching anchor, and
-- assert the anchor matched exactly once before executing. cancel_order,
-- record_session_payment and open_shift are small enough (30-40 lines) to
-- restate directly with no such risk.
-- ============================================================================

-- ── staff_place_order: gate discount APPLICATION, not order placement ──────
-- Only fires when a discount is actually being requested (p_discount_type is
-- not null and a positive value) — a café with 'discounts' off can still
-- place ordinary orders normally, it just can't apply a discount to one.
do $$
declare
  v_src     text;
  v_new     text;
  v_pattern text := 'if\s+p_discount_type\s+is\s+not\s+null\s+and\s+p_discount_type\s+not\s+in\s*' ||
                    '\(''percent'',\s*''flat''\)\s+then\s+raise\s+exception\s+''invalid discount type'';\s+end if;';
  v_hits    int;
begin
  select count(*) into v_hits
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'staff_place_order';
  if v_hits <> 1 then
    raise exception 'expected exactly one staff_place_order, found % — refusing to patch an ambiguous overload', v_hits;
  end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'staff_place_order';
  if v_src is null then
    raise exception 'staff_place_order does not exist';
  end if;

  select count(*) into v_hits from regexp_matches(v_src, v_pattern, 'gi');
  if v_hits <> 1 then
    raise exception 'expected exactly one discount-type-validation anchor in staff_place_order, found % — refusing to guess', v_hits;
  end if;

  v_new := regexp_replace(
    v_src, v_pattern,
    E'if p_discount_type is not null and p_discount_type not in (''percent'', ''flat'') then\n' ||
    E'    raise exception ''invalid discount type'';\n' ||
    E'  end if;\n\n' ||
    E'  if p_discount_type is not null and p_discount_value > 0 and not cafe_has_feature(p_cafe_id, ''discounts'') then\n' ||
    E'    raise exception ''discounts are turned off for this café'';\n' ||
    E'  end if;',
    'gi'
  );
  execute v_new;
  raise notice 'staff_place_order patched: discount application now gated on ''discounts''';
end $$;

-- self-check
do $$
declare v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'staff_place_order';
  if v_src !~ 'cafe_has_feature\(p_cafe_id, ''discounts''\)' then
    raise exception 'staff_place_order was not patched with the discounts entitlement check';
  end if;
end $$;

-- ── refund_order: gate the whole function on 'refunds' ──────────────────────
do $$
declare
  v_src     text;
  v_new     text;
  v_pattern text := 'if\s+v_role\s+not\s+in\s*\(''owner'',\s*''manager'',\s*''cashier''\)\s+then\s+' ||
                    'raise\s+exception\s+''your role cannot issue refunds'';\s+end if;';
  v_hits    int;
begin
  select count(*) into v_hits
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'refund_order';
  if v_hits <> 1 then
    raise exception 'expected exactly one refund_order, found % — refusing to patch an ambiguous overload', v_hits;
  end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'refund_order';
  if v_src is null then
    raise exception 'refund_order does not exist';
  end if;

  select count(*) into v_hits from regexp_matches(v_src, v_pattern, 'gi');
  if v_hits <> 1 then
    raise exception 'expected exactly one role-check anchor in refund_order, found % — refusing to guess', v_hits;
  end if;

  v_new := regexp_replace(
    v_src, v_pattern,
    E'if v_role not in (''owner'', ''manager'', ''cashier'') then\n' ||
    E'    raise exception ''your role cannot issue refunds'';\n' ||
    E'  end if;\n\n' ||
    E'  if not cafe_has_feature(v_order.cafe_id, ''refunds'') then\n' ||
    E'    raise exception ''refunds are turned off for this café'';\n' ||
    E'  end if;',
    'gi'
  );
  execute v_new;
  raise notice 'refund_order patched: gated on ''refunds''';
end $$;

-- self-check
do $$
declare v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'refund_order';
  if v_src !~ 'cafe_has_feature\(v_order.cafe_id, ''refunds''\)' then
    raise exception 'refund_order was not patched with the refunds entitlement check';
  end if;
end $$;

-- ── cancel_order: small enough to restate directly ──────────────────────────
create or replace function cancel_order(p_order_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id       uuid;
  v_status        order_status;
  v_payment_status payment_status;
  v_role          member_role;
begin
  select cafe_id, status, payment_status into v_cafe_id, v_status, v_payment_status
    from orders where id = p_order_id;
  if v_cafe_id is null then raise exception 'order not found'; end if;

  select role into v_role from cafe_members where cafe_id = v_cafe_id and user_id = auth.uid();
  if v_role is null then raise exception 'not authorized for this café'; end if;

  if not cafe_has_feature(v_cafe_id, 'order_cancel') then
    raise exception 'cancelling orders is turned off for this café';
  end if;

  if v_status in ('completed', 'cancelled') then
    raise exception 'this order is already % and cannot be cancelled', v_status;
  end if;

  if v_payment_status in ('paid', 'partial') then
    raise exception 'this order has payment recorded against it — cancelling it needs a refund (not available yet); reverse the payment with a manager first';
  end if;

  if v_status in ('preparing', 'ready', 'served') and v_role not in ('owner', 'manager') then
    raise exception 'the kitchen has already started this order — a manager or owner needs to cancel it';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'a cancellation reason is required';
  end if;

  update orders set status = 'cancelled', cancel_reason = trim(p_reason) where id = p_order_id;

  perform reverse_stock_for_cancelled_order(p_order_id);
end $$;

revoke execute on function cancel_order(uuid, text) from public, anon;
grant execute on function cancel_order(uuid, text) to authenticated;

-- ── record_session_payment: small enough to restate directly ───────────────
create or replace function record_session_payment(
  p_session_id  uuid,
  p_amount      integer,
  p_method      text,
  p_split_label text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id   uuid;
  v_remaining integer;
  v_take      integer;
  v_o         record;
  v_applied   integer := 0;
begin
  select cafe_id into v_cafe_id from table_sessions where id = p_session_id;
  if v_cafe_id is null then raise exception 'session not found'; end if;
  if not is_cafe_member(v_cafe_id) then raise exception 'not authorized'; end if;
  if not cafe_has_feature(v_cafe_id, 'split_payments') then
    raise exception 'split payments are turned off for this café';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be greater than zero'; end if;
  if p_method not in ('cash', 'card', 'upi') then raise exception 'invalid payment method'; end if;

  v_remaining := p_amount;
  for v_o in
    select o.id from orders o
     where o.session_id = p_session_id and o.status <> 'cancelled'
       and order_outstanding(o.id) > 0
     order by o.created_at asc
  loop
    exit when v_remaining <= 0;
    v_take := least(v_remaining, order_outstanding(v_o.id));
    if v_take > 0 then
      perform record_payment(v_o.id, v_take, p_method, p_split_label, 'split', null);
      v_remaining := v_remaining - v_take;
      v_applied   := v_applied + v_take;
    end if;
  end loop;

  return jsonb_build_object('applied', v_applied, 'unapplied', v_remaining);
end $$;

revoke execute on function record_session_payment(uuid, integer, text, text) from public, anon;
grant execute on function record_session_payment(uuid, integer, text, text) to authenticated;

-- ── open_shift: AND the new key into the existing owner-column check ───────
-- 0233 seeded 'cash_management' true on every plan, so
-- <cash_management_enabled column> AND <new key true> is identical to the
-- column alone for every café until an Ops admin deliberately overrides the
-- key off — matching the AND-pattern already proven for online_payments
-- (cafe_payments_enabled, 0164) and referral (cafe_plan_feature, 0112).
-- close_shift/record_cash_movement stay untouched — an already-open shift
-- must still be closeable, exactly as 0030 already documents.
create or replace function open_shift(p_cafe_id uuid, p_opening_cash integer default 0)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not has_cafe_role(p_cafe_id, array['owner','manager','cashier']::member_role[]) then
    raise exception 'your role cannot open a shift';
  end if;

  if not coalesce((select cash_management_enabled from cafes where id = p_cafe_id), false) then
    raise exception 'cash management is turned off for this café';
  end if;

  if not cafe_has_feature(p_cafe_id, 'cash_management') then
    raise exception 'cash management is turned off for this café';
  end if;

  if coalesce(p_opening_cash, 0) < 0 then raise exception 'opening cash cannot be negative'; end if;

  if exists (select 1 from cash_shifts where cafe_id = p_cafe_id and status = 'open') then
    raise exception 'a shift is already open — close it before opening another';
  end if;

  insert into cash_shifts (cafe_id, opening_cash, opened_by)
  values (p_cafe_id, coalesce(p_opening_cash, 0), auth.uid())
  returning id into v_id;

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (p_cafe_id, auth.uid(), 'shift.opened', 'cash_shifts', v_id,
          jsonb_build_object('opening_cash', coalesce(p_opening_cash, 0)));

  return v_id;
end $$;

revoke execute on function open_shift(uuid, integer) from public, anon;
grant execute on function open_shift(uuid, integer) to authenticated;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
declare v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'cancel_order';
  if v_src !~ 'cafe_has_feature\(v_cafe_id, ''order_cancel''\)' then
    raise exception 'cancel_order is missing the order_cancel entitlement check';
  end if;

  select pg_get_functiondef(p.oid) into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_session_payment';
  if v_src !~ 'cafe_has_feature\(v_cafe_id, ''split_payments''\)' then
    raise exception 'record_session_payment is missing the split_payments entitlement check';
  end if;

  select pg_get_functiondef(p.oid) into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'open_shift';
  if v_src !~ 'cafe_has_feature\(p_cafe_id, ''cash_management''\)' then
    raise exception 'open_shift is missing the cash_management entitlement check';
  end if;
end $$;
