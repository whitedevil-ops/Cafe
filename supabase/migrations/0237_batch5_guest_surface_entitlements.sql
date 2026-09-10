-- ============================================================================
-- 0237 — Batch 5 (final SQL batch) of the ungated-features entitlement
-- project: guest-facing surfaces. Every check below is cafe_feature_for_guest
-- — every function here is either anonymous by design (public_kds_orders,
-- get_receipt, the new public_cafe_upsell_enabled) or reachable from a guest
-- session that carries no auth.uid() (customer_order_history, which
-- authenticates via a device-scoped session token, not Supabase auth). Using
-- cafe_has_feature()/hasFeature() on any of these would fail PERMANENTLY
-- CLOSED for every café instead of failing open — the exact bug class
-- 0092/0112/0178/0235/0236 already hit.
-- ============================================================================

-- ── kds, guest half ──────────────────────────────────────────────────────
-- public_kds_orders/public_kds_advance_order (0178) already resolve cafe_id
-- internally from the slug — the check belongs there, not in
-- app/kds/[slug]/page.tsx, which never resolves a cafe_id at all (the exact
-- gap 0178 itself fixed once already). A disabled café's board returns an
-- empty list, same shape as an unknown slug — an unattended kitchen display
-- polling this should go quietly inert, not show an error state. The advance
-- action raises, same shape as "order not found", since a stray tap on a
-- disabled board is a real no-op, not a silent success.
create or replace function public_kds_orders(p_slug text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id uuid;
  v_result jsonb;
begin
  select id into v_cafe_id from cafes where slug = p_slug;
  if v_cafe_id is null then return '[]'::jsonb; end if;
  if not cafe_feature_for_guest(v_cafe_id, 'kds') then return '[]'::jsonb; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'order_id', o.id,
    'short_code', o.short_code,
    'created_at', o.created_at,
    'table_label', coalesce(t.label, '—'),
    'paid', o.payment_status = 'paid',
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object('id', oi.id, 'qty', oi.qty, 'name', oi.name) order by oi.id), '[]'::jsonb)
      from order_items oi where oi.order_id = o.id
    )
  ) order by o.created_at asc), '[]'::jsonb)
  into v_result
  from orders o
  left join cafe_tables t on t.id = o.table_id
  where o.cafe_id = v_cafe_id
    and o.status in ('placed', 'accepted', 'preparing', 'ready');

  return v_result;
end $$;

create or replace function public_kds_advance_order(p_slug text, p_order_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id uuid;
begin
  select id into v_cafe_id from cafes where slug = p_slug;
  if v_cafe_id is null then raise exception 'café not found'; end if;
  if not cafe_feature_for_guest(v_cafe_id, 'kds') then raise exception 'café not found'; end if;

  update orders
  set status = 'completed', done_at = now()
  where id = p_order_id
    and cafe_id = v_cafe_id
    and status in ('placed', 'accepted', 'preparing', 'ready', 'served');

  if not found then
    raise exception 'order not found, or not open, for this café';
  end if;
end $$;

-- ── digital_receipts ─────────────────────────────────────────────────────
-- get_receipt (latest body: 0213) is `language sql`, not plpgsql — wrap its
-- existing select in a case rather than converting the whole function.
-- app/r/[token]/page.tsx already does `if (!data) notFound()` for an unknown
-- token, so a disabled café's receipt link produces the identical "not
-- found" page with no client change needed. This is a whole-page kill
-- switch: also takes down the embedded Spin widget, AutoPrint, and the PDF
-- button that page renders from this same payload.
create or replace function get_receipt(p_token uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not cafe_feature_for_guest(o.cafe_id, 'digital_receipts') then null else jsonb_build_object(
    'cafe', jsonb_build_object(
      'name', c.name,
      'legal_name', c.legal_name,
      'trade_name', c.trade_name,
      'address', c.address, 'city', c.city, 'state', c.state, 'pincode', c.pincode,
      'gstin', c.gstin, 'logo_url', c.logo_url, 'phone', c.phone,
      'gst_registered', c.gst_registered,
      'tax_inclusive', c.tax_inclusive,
      'timezone', coalesce(c.timezone, 'Asia/Kolkata'),
      'bill_link_url', case when c.bill_link_enabled then c.bill_link_url else null end,
      'bill_link_label', case when c.bill_link_enabled then c.bill_link_label else null end),
    'order', jsonb_build_object(
      'short_code', o.short_code, 'created_at', o.created_at, 'status', o.status,
      'order_type', o.type,
      'payment_status', o.payment_status, 'payment_method', o.payment_method,
      'subtotal', o.subtotal, 'discount', o.discount, 'tax', o.tax,
      'service_charge', o.service_charge, 'total', o.total,
      'coupon_code', o.coupon_code, 'table_label', t.label,
      'phone_masked', case when o.phone is not null then '******' || right(o.phone, 4) end,
      'phone_full', case when is_cafe_member(o.cafe_id) then o.phone end,
      'customer_name', cu.name,
      'staff_name', p.full_name,
      'notes', nullif(trim(o.notes), ''),
      'spin_prize', (
        select jsonb_build_object('label', sr.label, 'code', sr.code, 'kind', sr.kind, 'value', sr.value)
        from spin_results sr where sr.redeemed_order_id = o.id limit 1
      )),
    'gst_invoice', case when o.gst_invoice_number is not null then jsonb_build_object(
      'invoice_number',  o.gst_invoice_number,
      'issued_at',       o.gst_invoice_issued_at,
      'taxable_amount',  (select coalesce(sum(i.taxable_value), 0) from order_items i where i.order_id = o.id),
      'cgst',            o.tax / 2,
      'sgst',            o.tax - (o.tax / 2),
      'place_of_supply', coalesce(c.state, '') ||
                         case when c.state_code is not null then ' (' || c.state_code || ')' else '' end
    ) else null end,
    'credit_notes', (select coalesce(jsonb_agg(jsonb_build_object(
        'credit_note_number', r.credit_note_number,
        'issued_at', r.credit_note_issued_at,
        'amount', r.amount,
        'taxable_value', r.credit_note_taxable_value,
        'tax_amount', r.credit_note_tax_amount,
        'cgst', r.credit_note_tax_amount / 2,
        'sgst', r.credit_note_tax_amount - (r.credit_note_tax_amount / 2),
        'reason', r.reason
      ) order by r.credit_note_issued_at), '[]'::jsonb)
      from refunds r
      where r.order_id = o.id and r.credit_note_number is not null and r.status = 'completed'),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object(
        'method', p2.method, 'amount', p2.amount, 'reference', p2.reference,
        'status', p2.status, 'provider', p2.provider, 'created_at', p2.created_at
      ) order by p2.created_at), '[]'::jsonb)
      from payments p2 where p2.order_id = o.id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'name', i.name, 'qty', i.qty, 'price', i.price, 'modifiers', i.modifiers,
        'hsn_sac', i.hsn_sac, 'tax_percent', i.tax_percent,
        'taxable_value', i.taxable_value, 'tax_amount', i.tax_amount,
        'is_reward', i.reward_id is not null,
        'combo_group', i.combo_group,
        'combo_name', cb.name,
        'combo_price', cb.price)
        order by i.combo_group nulls first, i.name), '[]'::jsonb)
      from order_items i
      left join combos cb on cb.id = i.combo_id
      where i.order_id = o.id)
  ) end
  from orders o
  join cafes c on c.id = o.cafe_id
  left join cafe_tables t on t.id = o.table_id
  left join customers cu on cu.id = o.customer_id
  left join profiles p on p.id = o.staff_id
  where o.receipt_token = p_token;
$$;

grant execute on function get_receipt(uuid) to anon, authenticated;

-- ── customer_my_orders ───────────────────────────────────────────────────
-- customer_order_history (latest body: 0087) authenticates via a
-- device-scoped session token, not Supabase auth — customer_session_identity
-- resolves it below, and the function stays guest-safe regardless. Returns
-- {available:false} rather than raising: my-orders-client.tsx's existing
-- error handler treats any RPC error as "session expired", clears the
-- session, and bounces back to the login gate — which would be a confusing
-- message for "not offered here". The client below grows one small branch
-- to render that state instead.
create or replace function customer_order_history(
  p_session_token text, p_limit integer default 10, p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_customer_id uuid;
  v_cafe_id     uuid;
  v_device_id   text;
  v_limit       integer := least(greatest(coalesce(p_limit, 10), 1), 50);
  v_total       integer;
begin
  select i.customer_id, i.cafe_id, i.device_id into v_customer_id, v_cafe_id, v_device_id
    from customer_session_identity(p_session_token) i;
  if v_customer_id is null then raise exception 'session expired — please verify your number again'; end if;

  if not cafe_feature_for_guest(v_cafe_id, 'customer_my_orders') then
    return jsonb_build_object('available', false);
  end if;

  select count(*) into v_total from orders o
    where o.device_id = v_device_id and o.cafe_id = v_cafe_id and o.status <> 'cancelled';

  return jsonb_build_object(
    'available', true,
    'total', v_total,
    'limit', v_limit,
    'offset', greatest(coalesce(p_offset, 0), 0),
    'cafe_name', (select c.name from cafes c where c.id = v_cafe_id),
    'orders', coalesce((
      select jsonb_agg(row_to_json(x) order by x.created_at desc) from (
        select
          o.id, o.short_code, o.status, o.payment_status, o.payment_method,
          o.subtotal, o.discount, o.tax, o.service_charge, o.total,
          o.created_at, o.receipt_token, o.type,
          (select t.label from cafe_tables t where t.id = o.table_id) as table_label,
          (select coalesce(jsonb_agg(jsonb_build_object(
             'name', oi.name, 'qty', oi.qty, 'price', oi.price, 'modifiers', oi.modifiers
           ) order by oi.id), '[]'::jsonb)
           from order_items oi where oi.order_id = o.id) as items
        from orders o
        where o.device_id = v_device_id and o.cafe_id = v_cafe_id and o.status <> 'cancelled'
        order by o.created_at desc
        limit v_limit offset greatest(coalesce(p_offset, 0), 0)
      ) x
    ), '[]'::jsonb)
  );
end $$;

-- ── upsell_prompt ────────────────────────────────────────────────────────
-- New guest-safe RPC, modeled byte-for-byte on public_cafe_spin_enabled
-- (0214): resolve cafe_id from the table token, delegate to
-- cafe_feature_for_guest, grant to anon/authenticated.
create or replace function public_cafe_upsell_enabled(p_table_token text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_cafe_id uuid;
begin
  select cafe_id into v_cafe_id from cafe_tables where token = p_table_token;
  if v_cafe_id is null then return false; end if;
  return cafe_feature_for_guest(v_cafe_id, 'upsell_prompt');
end $$;

revoke execute on function public_cafe_upsell_enabled(text) from public;
grant execute on function public_cafe_upsell_enabled(text) to anon, authenticated;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
declare v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'public_kds_orders';
  if v_src !~ 'cafe_feature_for_guest\(v_cafe_id, ''kds''\)' then
    raise exception 'public_kds_orders is missing the kds entitlement check';
  end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'public_kds_advance_order';
  if v_src !~ 'cafe_feature_for_guest\(v_cafe_id, ''kds''\)' then
    raise exception 'public_kds_advance_order is missing the kds entitlement check';
  end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_receipt';
  if v_src !~ 'cafe_feature_for_guest\(o.cafe_id, ''digital_receipts''\)' then
    raise exception 'get_receipt is missing the digital_receipts entitlement check';
  end if;
  if v_src !~ 'is_cafe_member\(o.cafe_id\) then o.phone' then
    raise exception 'get_receipt lost the phone_full member gate from 0209';
  end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'customer_order_history';
  if v_src !~ 'cafe_feature_for_guest\(v_cafe_id, ''customer_my_orders''\)' then
    raise exception 'customer_order_history is missing the customer_my_orders entitlement check';
  end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'public_cafe_upsell_enabled';
  if v_src is null then raise exception 'public_cafe_upsell_enabled does not exist'; end if;
  if v_src !~ 'cafe_feature_for_guest\(v_cafe_id, ''upsell_prompt''\)' then
    raise exception 'public_cafe_upsell_enabled is missing the upsell_prompt entitlement check';
  end if;

  -- The one thing that must NEVER be true anywhere in this migration — every
  -- function above is guest-reachable, so a member-only check would fail
  -- every one of them permanently closed for anonymous callers.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('public_kds_orders', 'public_kds_advance_order', 'get_receipt',
                          'customer_order_history', 'public_cafe_upsell_enabled')
       and pg_get_functiondef(p.oid) ~ 'cafe_has_feature\('
  ) then
    raise exception 'a Batch 5 guest-facing function uses cafe_has_feature (member-only) — every guest surface must use cafe_feature_for_guest';
  end if;
end $$;
