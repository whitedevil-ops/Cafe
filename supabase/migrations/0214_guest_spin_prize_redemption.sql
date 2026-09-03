-- ============================================================================
-- 0214 — A guest can redeem their own Spin & Win prize code themselves, at
-- checkout, without ever talking to staff.
--
-- Re-audited the whole flow end to end per a fresh, very specific ask: "no
-- reliable customer-facing place to enter/redeem a Spin & Win reward code."
-- That's accurate. It was true by design, not by accident — 0205's own header
-- argues redemption should stay staff-only because a spin_results row "can
-- only be minted by spin_the_wheel, which is gated" and redeeming inside
-- staff_place_order's transaction means a bad redemption aborts the whole
-- bill rather than dropping a discount silently. Both of those properties are
-- worth keeping. What was wrong was the CONCLUSION drawn from them: "staff-only"
-- was never actually load-bearing for either property — a guest-safe caller
-- gets exactly the same guarantees, because the guard logic itself doesn't
-- care who is calling, only that the order is real and belongs to this café.
--
-- The VISIBILITY side of "sometimes does not see Spin & Win at all" was
-- already root-caused and fixed earlier today (0207, plus the
-- components/qr/spin-wheel.tsx rewrite): the RPC swallowed errors, there was
-- no loading state, a counter-paid order never re-polled, the POS redemption
-- box was gated on the wrong entitlement key, and spin_wheel_analytics didn't
-- exist. Re-verified in this pass and confirmed still correct — see this
-- migration's own header notes below and the session's final report.
--
-- WHAT THIS MIGRATION ADDS
--
--   redeem_spin_prize_core(cafe, code, order)   — the actual guarded logic,
--     extracted verbatim from 0210's redeem_spin_prize (same four checks,
--     same advisory lock, same FOR UPDATE, same deliberate absence of an
--     entitlement re-check per 0205). Granted to nobody — reachable only
--     because its two callers are both SECURITY DEFINER, the exact pattern
--     0204 already established for cafe_feature_for_guest.
--
--   redeem_spin_prize(cafe, code, order)        — now a four-line wrapper:
--     check the caller is a café member, then call the core. Byte-identical
--     external behaviour to 0210 — same signature, same grants, same errors,
--     same audit shape when called from staff_place_order. Nothing that calls
--     this today needs to change.
--
--   place_order(..., p_spin_code)               — the GUEST-facing order RPC
--     gains the same trailing parameter staff_place_order has had since 0126,
--     wired in exactly the same place relative to the item loop and the
--     coupon block, calling the new core function instead of the member-gated
--     wrapper. A guest who types their own won code before placing their next
--     order gets it redeemed atomically, in the same transaction as the order
--     itself — no staff screen involved, and no new discount-computation path
--     to keep in sync (it's the same three-branch item/percent/flat math
--     staff_place_order already has, copied, not reinvented).
--
--   preview_spin_prize_for_guest(cafe, code)    — read-only, guest-safe
--     lookup for the ordering UI to show "10% off next visit — ✓ applied"
--     BEFORE the guest commits to placing an order, mirroring exactly how
--     validate_coupon_public already lets a guest preview a coupon. This does
--     NOT consume the code (no lock, no update) — the real, authoritative
--     consumption still happens once, atomically, inside place_order via
--     redeem_spin_prize_core. Scoped by cafe_id exactly like the existing
--     staff-only find_spin_prize (0125) — a code string only ever matches
--     rows at the café it was drawn from, so there is no cross-tenant lookup
--     surface here, same as there never was one there.
--
--   public_cafe_spin_enabled(p_table_token)     — guest-safe "should the
--     ordering page even show a reward-code box" check, mirroring
--     public_cafe_coupons_enabled's (0183) exact shape and grants — except
--     it DELEGATES to cafe_feature_for_guest(cafe_id, 'spin') instead of
--     re-copying the override-then-plan logic a third time. That's the actual
--     fix for "search the codebase for duplicate/contradictory Spin & Win
--     visibility logic": there is now exactly ONE function that resolves the
--     'spin' entitlement for an unauthenticated caller, and every guest-facing
--     check (get_spin_wheel, spin_the_wheel, and now this) goes through it.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT TOUCH
--
--   staff_place_order, the POS SpinClaim UI, find_spin_prize — the staff
--   redemption path is completely unchanged, byte-for-byte, external
--   behaviour included. This is additive: a second front door on the same
--   house, not a replacement for the first one. A walk-in customer with no
--   phone and no QR order still gets served at the till exactly as before.
--
--   The spin DRAW itself (spin_the_wheel) — untouched. Prize selection stays
--   server-side, atomic, and locked (pg_advisory_xact_lock keyed on the
--   order id) exactly as it already was; this migration is entirely about
--   what happens to a code AFTER it exists.
-- ============================================================================

-- ── 1. The guarded core, extracted from 0210's redeem_spin_prize ───────────
create or replace function redeem_spin_prize_core(p_cafe_id uuid, p_code text, p_order_id uuid)
returns spin_results
language plpgsql security definer set search_path = public as $$
declare v_r spin_results%rowtype;
begin
  -- Same two guards 0210 added, unchanged: a prize is a discount ON
  -- something, and destroying one with no bill attached is how #4-#7's
  -- sibling bug — an untraceable, unattributed financial change — happens.
  if p_order_id is null then
    raise exception 'a spin prize can only be claimed against a bill';
  end if;
  if not exists (select 1 from orders where id = p_order_id and cafe_id = p_cafe_id) then
    raise exception 'that bill does not belong to this café';
  end if;

  perform pg_advisory_xact_lock(hashtext('spinclaim:' || p_cafe_id::text || ':' || upper(trim(p_code))));

  select * into v_r from spin_results
   where cafe_id = p_cafe_id and upper(code) = upper(trim(p_code)) for update;
  if not found then raise exception 'no prize with that code'; end if;
  if v_r.redeemed_at is not null then raise exception 'that prize has already been claimed'; end if;
  if v_r.expires_at is not null and v_r.expires_at < now() then raise exception 'that prize has expired'; end if;
  if v_r.kind = 'none' then raise exception 'that spin did not win anything'; end if;

  update spin_results
     set redeemed_at = now(), redeemed_order_id = p_order_id
   where id = v_r.id
  returning * into v_r;

  return v_r;
end $$;

-- No grants at all, on purpose — see cafe_feature_for_guest (0204) for the
-- same pattern. Reachable only via a SECURITY DEFINER caller.
revoke execute on function redeem_spin_prize_core(uuid, text, uuid) from public, anon, authenticated;

-- ── 2. redeem_spin_prize: now a thin, member-gated wrapper ─────────────────
-- External behaviour is unchanged from 0210 — same signature, same grants,
-- same four error messages, same lock. staff_place_order calls this exact
-- function exactly as before; nothing there needed to change.
create or replace function redeem_spin_prize(p_cafe_id uuid, p_code text, p_order_id uuid default null)
returns spin_results
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from cafe_members where cafe_id = p_cafe_id and user_id = auth.uid()) then
    raise exception 'not authorized for this café';
  end if;
  return redeem_spin_prize_core(p_cafe_id, p_code, p_order_id);
end $$;

revoke execute on function redeem_spin_prize(uuid, text, uuid) from public, anon;
grant execute on function redeem_spin_prize(uuid, text, uuid) to authenticated;

-- ── 3. A guest-safe PREVIEW, so the ordering page can show what a code is
--    worth before the guest commits — the same UX validate_coupon_public
--    already gives a coupon. Does not touch redeemed_at; look-only. ────────
create or replace function preview_spin_prize_for_guest(p_cafe_id uuid, p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_r spin_results%rowtype;
begin
  select * into v_r from spin_results
   where cafe_id = p_cafe_id and upper(code) = upper(trim(p_code));
  if not found then raise exception 'no prize with that code'; end if;

  return jsonb_build_object(
    'label', v_r.label, 'kind', v_r.kind, 'value', v_r.value,
    'menu_item_id', v_r.menu_item_id, 'variant_id', v_r.variant_id,
    'redeemed', v_r.redeemed_at is not null,
    'expired', v_r.expires_at is not null and v_r.expires_at < now()
  );
end $$;

revoke execute on function preview_spin_prize_for_guest(uuid, text) from public;
grant execute on function preview_spin_prize_for_guest(uuid, text) to anon, authenticated;

-- ── 4. public_cafe_spin_enabled: the one place that answers "should the
--    ordering page show a reward-code box" for an anon caller ─────────────
create or replace function public_cafe_spin_enabled(p_table_token text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_cafe_id uuid;
begin
  select cafe_id into v_cafe_id from cafe_tables where token = p_table_token;
  if v_cafe_id is null then return false; end if;
  -- Delegates rather than re-deriving override-then-plan a third time —
  -- get_spin_wheel and spin_the_wheel already resolve the 'spin' entitlement
  -- for an anon caller through cafe_feature_for_guest (0204). This is now the
  -- only other guest-facing 'spin' check in the schema, and it goes through
  -- the same function, so the two can never silently disagree.
  return cafe_feature_for_guest(v_cafe_id, 'spin');
end $$;

revoke execute on function public_cafe_spin_enabled(text) from public;
grant execute on function public_cafe_spin_enabled(text) to anon, authenticated;

-- ── 5. place_order: the guest ordering RPC gains p_spin_code ───────────────
-- Full restatement from 0164 (the current live body — confirmed the single
-- most recent definition, never touched by a surgical pg_get_functiondef
-- patch), with exactly these additions: the new trailing parameter, two new
-- declared locals, the redemption block itself (placed right after the item
-- loop finishes and v_subtotal is known — the same position staff_place_order
-- uses, and before the coupon block so the two audit rows read in the same
-- order a reader of staff_place_order would already expect), v_spin_disc
-- folded into the same apply_order_taxes call the coupon discount already
-- goes through, and one audit row matching staff_place_order's
-- 'spin.prize_claimed' shape with actor_id null (a guest, exactly like this
-- function's own existing 'order.created' row already does).
create or replace function place_order(
  p_token             text,
  p_items             jsonb,
  p_phone             text default null,
  p_payment_method    text default 'counter',
  p_upsell_item_id    uuid default null,
  p_upsell_shown      boolean default false,
  p_client_request_id uuid default null,
  p_coupon_code       text default null,
  p_device_id         text default null,
  p_spin_code         text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id       uuid;
  v_cafe_status   text;
  v_table_id      uuid;
  v_session_id    uuid;
  v_order_id      uuid;
  v_customer_id   uuid;
  v_phone         text;
  v_receipt       uuid;
  v_subtotal      integer := 0;
  v_seq           integer;
  v_day_start     timestamptz;
  v_weekday       smallint;
  v_item          jsonb;
  v_qty           integer;
  v_id            uuid;
  v_name          text;
  v_price         integer;
  v_offer_price   integer;
  v_offer_days    integer[];
  v_unit          integer;
  v_mods          jsonb;
  v_note          text;
  v_has_variants  boolean;
  v_variant_id    uuid;
  v_vname         text;
  v_vdelta        integer;
  v_addon         text;
  v_aname         text;
  v_aprice        integer;
  v_upsell_taken  boolean := false;
  v_upsell_value  integer := 0;
  v_tax           integer;
  v_svc           integer;
  v_total         integer;
  v_discount      integer;
  v_existing      record;
  v_coupon        jsonb;
  v_coupon_disc   integer := 0;
  v_cat_ids       uuid[];
  v_combo_id      uuid;
  v_combo_savings integer := 0;
  v_spin          spin_results%rowtype;
  v_spin_disc     integer := 0;
begin
  if p_payment_method not in ('counter','cash','card') then
    raise exception 'invalid payment method';
  end if;

  v_phone := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
  if v_phone is not null and v_phone !~ '^[6-9][0-9]{9}$' then
    raise exception 'invalid phone number';
  end if;

  select id, cafe_id into v_table_id, v_cafe_id from cafe_tables where token = p_token;
  if v_cafe_id is null then raise exception 'invalid table'; end if;

  select status into v_cafe_status from cafes where id = v_cafe_id;
  if v_cafe_status <> 'active' then raise exception 'this café is not currently accepting orders'; end if;

  if not public_cafe_ordering_enabled(p_token) then
    raise exception 'ordering is currently paused for this café';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'empty order';
  end if;

  if p_client_request_id is not null then
    select short_code, total, receipt_token into v_existing
      from orders where cafe_id = v_cafe_id and client_request_id = p_client_request_id;
    if found then
      return jsonb_build_object('short_code', v_existing.short_code, 'total', v_existing.total,
                                 'receipt_token', v_existing.receipt_token);
    end if;
  end if;

  v_session_id := get_or_create_session(v_cafe_id, v_table_id);

  if v_phone is not null then
    insert into customers (cafe_id, phone, last_seen)
    values (v_cafe_id, v_phone, now())
    on conflict (cafe_id, phone) do update set last_seen = now()
    returning id into v_customer_id;
  end if;

  v_day_start := cafe_day_start(v_cafe_id);
  v_weekday := cafe_current_weekday(v_cafe_id);
  select count(*) + 1 into v_seq from orders
    where cafe_id = v_cafe_id and status <> 'cancelled' and created_at >= v_day_start;

  insert into orders (cafe_id, table_id, session_id, customer_id, short_code, type, status, payment_status,
                      phone, payment_method, subtotal, total, upsell_shown, source, client_request_id, device_id)
    values (v_cafe_id, v_table_id, v_session_id, v_customer_id, v_seq::text, 'dine_in', 'placed', 'unpaid',
            v_phone, p_payment_method::payment_method, 0, 0, coalesce(p_upsell_shown, false), 'qr', p_client_request_id,
            nullif(trim(coalesce(p_device_id, '')), ''))
    returning id, receipt_token into v_order_id, v_receipt;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(1, coalesce((v_item->>'qty')::int, 1));

    v_combo_id := nullif(v_item->>'combo_id', '')::uuid;
    if v_combo_id is not null then
      v_combo_savings := v_combo_savings + expand_combo_line(
        v_order_id, v_cafe_id, v_combo_id, coalesce(v_item->'selections', '[]'::jsonb), v_qty);
      continue;
    end if;

    select id, name, price, offer_price, offer_days
      into v_id, v_name, v_price, v_offer_price, v_offer_days
      from menu_items
      where id = (v_item->>'item_id')::uuid
        and cafe_id = v_cafe_id and available = true and archived = false;
    if v_id is null then raise exception 'item not available'; end if;

    v_unit := case
      when v_offer_price is not null and v_offer_days is not null and v_weekday = any(v_offer_days)
        then v_offer_price
      else v_price
    end;
    v_mods := '[]'::jsonb;

    v_has_variants := exists (select 1 from menu_item_variants where menu_item_id = v_id);
    v_variant_id := nullif(v_item->>'variant_id','')::uuid;
    if v_has_variants and v_variant_id is null then
      raise exception 'variant required';
    end if;
    if v_variant_id is not null then
      select name, price_delta into v_vname, v_vdelta
        from menu_item_variants where id = v_variant_id and menu_item_id = v_id;
      if v_vname is null then raise exception 'invalid variant'; end if;
      v_unit := v_unit + v_vdelta;
      v_mods := v_mods || jsonb_build_object('name', v_vname, 'price', v_vdelta);
      v_name := v_name || ' (' || v_vname || ')';
    end if;

    if v_item ? 'addon_ids' then
      for v_addon in select jsonb_array_elements_text(v_item->'addon_ids') loop
        select name, price into v_aname, v_aprice
          from menu_item_addons where id = v_addon::uuid and menu_item_id = v_id;
        if v_aname is null then raise exception 'invalid add-on'; end if;
        v_unit := v_unit + v_aprice;
        v_mods := v_mods || jsonb_build_object('name', v_aname, 'price', v_aprice);
      end loop;
    end if;

    v_note := nullif(trim(left(coalesce(v_item->>'note', ''), 140)), '');

    insert into order_items (order_id, menu_item_id, name, price, qty, modifiers, instructions, variant_id)
      values (v_order_id, v_id, v_name, v_unit, v_qty, v_mods, v_note, v_variant_id);

    if p_upsell_item_id is not null and v_id = p_upsell_item_id then
      v_upsell_taken := true;
      v_upsell_value := v_unit * v_qty;
    end if;
  end loop;

  select coalesce(sum(price * qty), 0) into v_subtotal
    from order_items where order_id = v_order_id;

  -- NEW: guest self-redemption. Placed here — after items exist (an 'item'
  -- kind prize needs to check one is on the bill, same reason
  -- staff_place_order redeems before it computes coupons too) and before the
  -- coupon block, mirroring staff_place_order's exact shape so the two read
  -- the same way side by side.
  if p_spin_code is not null and trim(p_spin_code) <> '' then
    v_spin := redeem_spin_prize_core(v_cafe_id, p_spin_code, v_order_id);

    if v_spin.kind = 'item' then
      select oi.price into v_spin_disc
        from order_items oi
       where oi.order_id = v_order_id
         and oi.menu_item_id = v_spin.menu_item_id
         and (v_spin.variant_id is null or oi.variant_id = v_spin.variant_id)
       order by oi.price desc
       limit 1;
      if v_spin_disc is null then
        raise exception 'add "%" to your order before claiming this prize', v_spin.label;
      end if;
    elsif v_spin.kind = 'percent' then
      v_spin_disc := round(greatest(0, v_subtotal - v_combo_savings) * v_spin.value / 100.0);
    elsif v_spin.kind = 'flat' then
      v_spin_disc := v_spin.value;
    end if;

    insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
    values (v_cafe_id, null, 'spin.prize_claimed', 'orders', v_order_id,
            jsonb_build_object('code', upper(trim(p_spin_code)), 'label', v_spin.label,
                               'kind', v_spin.kind, 'amount', v_spin_disc));
  end if;

  if p_coupon_code is not null and trim(p_coupon_code) <> '' then
    perform pg_advisory_xact_lock(hashtext('coupon:' || v_cafe_id::text || ':' || upper(trim(p_coupon_code))));
    select coalesce(array_agg(distinct mi.category_id), array[]::uuid[]) into v_cat_ids
      from order_items oi join menu_items mi on mi.id = oi.menu_item_id
      where oi.order_id = v_order_id and mi.category_id is not null;
    v_coupon := resolve_coupon_discount(v_cafe_id, p_coupon_code,
                                        greatest(0, v_subtotal - v_combo_savings), v_customer_id, v_cat_ids);
    v_coupon_disc := (v_coupon->>'discount')::integer;
  end if;

  select t.subtotal, t.discount, t.tax, t.service_charge, t.total
    into v_subtotal, v_discount, v_tax, v_svc, v_total
    from apply_order_taxes(v_order_id, v_combo_savings + v_coupon_disc + greatest(0, coalesce(v_spin_disc, 0))) t;

  update orders
     set upsell_item_id = p_upsell_item_id,
         upsell_taken   = v_upsell_taken,
         upsell_value   = v_upsell_value,
         coupon_code    = case when v_coupon is not null then v_coupon->>'code' end
   where id = v_order_id;

  if v_coupon is not null then
    insert into coupon_redemptions (cafe_id, coupon_id, order_id, customer_id, discount_amount)
    values (v_cafe_id, (v_coupon->>'coupon_id')::uuid, v_order_id, v_customer_id, v_coupon_disc);
  end if;

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (v_cafe_id, null, 'order.created', 'orders', v_order_id,
          jsonb_build_object('source', 'qr', 'total', v_total, 'table_id', v_table_id));

  insert into notifications (cafe_id, type, message, table_id, session_id)
  select v_cafe_id, 'new_order', 'Table ' || t.label || ' placed a new order — #' || v_seq, v_table_id, v_session_id
  from cafe_tables t where t.id = v_table_id;

  return jsonb_build_object('short_code', v_seq::text, 'total', v_total, 'receipt_token', v_receipt, 'discount', v_discount);
exception
  when unique_violation then
    if p_client_request_id is not null then
      select short_code, total, receipt_token into v_existing
        from orders where cafe_id = v_cafe_id and client_request_id = p_client_request_id;
      if found then
        return jsonb_build_object('short_code', v_existing.short_code, 'total', v_existing.total,
                                   'receipt_token', v_existing.receipt_token);
      end if;
    end if;
    raise;
end $$;

revoke execute on function place_order(text, jsonb, text, text, uuid, boolean, uuid, text, text, text) from public;
grant execute on function place_order(text, jsonb, text, text, uuid, boolean, uuid, text, text, text) to anon, authenticated;

-- ── self-check ─────────────────────────────────────────────────────────────
do $$
declare v_src text;
begin
  if (select count(*) from pg_proc where proname = 'redeem_spin_prize_core') <> 1 then
    raise exception 'redeem_spin_prize_core: expected exactly one overload';
  end if;
  if (select count(*) from pg_proc where proname = 'redeem_spin_prize') <> 1 then
    raise exception 'redeem_spin_prize: expected exactly one overload';
  end if;
  if (select count(*) from pg_proc where proname = 'place_order') <> 1 then
    raise exception 'place_order: expected exactly one overload — a signature change must have created a second one instead of replacing the original';
  end if;

  select p.prosrc into v_src from pg_proc p where p.proname = 'redeem_spin_prize_core';
  if position('a spin prize can only be claimed against a bill' in v_src) = 0 then
    raise exception 'redeem_spin_prize_core lost the order-required guard';
  end if;
  if position('that bill does not belong to this café' in v_src) = 0 then
    raise exception 'redeem_spin_prize_core lost the tenant-scoping guard';
  end if;
  -- 0205's whole point, preserved: no entitlement re-check at redemption.
  if position('cafe_has_feature' in v_src) > 0 or position('cafe_feature_for_guest' in v_src) > 0 then
    raise exception 'redeem_spin_prize_core regained an entitlement check — 0205 removed it deliberately';
  end if;

  select p.prosrc into v_src from pg_proc p where p.proname = 'redeem_spin_prize';
  if position('cafe_members' in v_src) = 0 then
    raise exception 'redeem_spin_prize lost its staff membership check';
  end if;
  if position('redeem_spin_prize_core' in v_src) = 0 then
    raise exception 'redeem_spin_prize no longer delegates to the shared core';
  end if;

  select p.prosrc into v_src from pg_proc p where p.proname = 'place_order';
  if position('p_spin_code' in v_src) = 0 then
    raise exception 'place_order is missing p_spin_code';
  end if;
  if position('redeem_spin_prize_core' in v_src) = 0 then
    raise exception 'place_order does not call redeem_spin_prize_core';
  end if;
  -- redeem_spin_prize (the member-gated wrapper) must NOT be what a guest
  -- order calls — that would raise 'not authorized' for every anon guest.
  if position('redeem_spin_prize(' in v_src) > 0 then
    raise exception 'place_order calls the staff-gated redeem_spin_prize instead of the guest-safe core';
  end if;
  -- 0164's own fixes must have survived this restatement.
  if position('public_cafe_ordering_enabled' in v_src) = 0 then
    raise exception 'place_order lost the qr_ordering kill-switch check from 0164';
  end if;
  if position('unique_violation' in v_src) = 0 then
    raise exception 'place_order lost its idempotent-retry handling';
  end if;

  if not has_function_privilege('anon', 'place_order(text, jsonb, text, text, uuid, boolean, uuid, text, text, text)', 'execute') then
    raise exception 'anon cannot execute the new place_order signature';
  end if;

  if (select count(*) from pg_proc where proname = 'preview_spin_prize_for_guest') <> 1 then
    raise exception 'preview_spin_prize_for_guest was not created';
  end if;
  if not has_function_privilege('anon', 'preview_spin_prize_for_guest(uuid, text)', 'execute') then
    raise exception 'anon cannot execute preview_spin_prize_for_guest';
  end if;

  if (select count(*) from pg_proc where proname = 'public_cafe_spin_enabled') <> 1 then
    raise exception 'public_cafe_spin_enabled was not created';
  end if;
  select p.prosrc into v_src from pg_proc p where p.proname = 'public_cafe_spin_enabled';
  if position('cafe_feature_for_guest' in v_src) = 0 then
    raise exception 'public_cafe_spin_enabled does not delegate to cafe_feature_for_guest — it is re-deriving the entitlement instead of reusing the one source of truth';
  end if;
  if not has_function_privilege('anon', 'public_cafe_spin_enabled(text)', 'execute') then
    raise exception 'anon cannot execute public_cafe_spin_enabled';
  end if;
end $$;
