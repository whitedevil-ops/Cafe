-- ============================================================================
-- WhatsApp bill sending: make the on/off control ops-only, using the SAME
-- mechanism qr_ordering's kill switch already established (0084) — a
-- cafe_feature_overrides row — rather than the separate cafes.
-- whatsapp_bills_enabled column 0158 just added. That column would have been
-- a second, redundant on/off concept sitting next to an override system that
-- already does exactly this and already has an ops UI (the "WhatsApp Bill
-- Receipts" row in app/ops/cafes/[id]/cafe-detail-client.tsx's FEATURES
-- grid, wired up back in 0156). One lever, not two.
--
-- whatsapp_bills_active() mirrors cafe_has_feature()'s override-then-plan
-- precedence exactly, minus the is_cafe_member() gate — that gate exists to
-- stop cross-tenant probing over the client-facing RPC, which doesn't apply
-- here: this is only ever called from inside the enqueue triggers below,
-- already scoped to the order's own cafe_id, never exposed as a public RPC
-- itself.
-- ============================================================================

create or replace function whatsapp_bills_active(p_cafe_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_override boolean;
  v_plan_key text;
  v_features jsonb;
begin
  select enabled into v_override from cafe_feature_overrides
    where cafe_id = p_cafe_id and feature_key = 'whatsapp_bills';
  if v_override is not null then return v_override; end if;

  select plan into v_plan_key from cafes where id = p_cafe_id;
  select features into v_features from platform_plans where key = v_plan_key;
  if v_features is null then return false; end if;
  return coalesce((v_features ->> 'whatsapp_bills')::boolean, false);
end $$;
revoke execute on function whatsapp_bills_active(uuid) from public, anon;

create or replace function enqueue_order_placed_whatsapp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.phone is not null and whatsapp_bills_active(new.cafe_id) then
    insert into whatsapp_logs (cafe_id, order_id, customer_id, phone_masked, type, status)
    values (new.cafe_id, new.id, new.customer_id, '******' || right(new.phone, 4), 'order_placed', 'pending');
  end if;
  return new;
end $$;

create or replace function enqueue_bill_whatsapp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.payment_status = 'paid'::payment_status and old.payment_status is distinct from 'paid'::payment_status
     and new.phone is not null and whatsapp_bills_active(new.cafe_id) then
    insert into whatsapp_logs (cafe_id, order_id, customer_id, phone_masked, type, status)
    values (new.cafe_id, new.id, new.customer_id, '******' || right(new.phone, 4), 'bill', 'pending');
  end if;
  return new;
end $$;

-- The per-café toggle now lives entirely in cafe_feature_overrides; this
-- column was never read by anything else.
alter table cafes drop column if exists whatsapp_bills_enabled;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_proc where proname = 'whatsapp_bills_active') <> 1 then
    raise exception 'whatsapp_bills_active: expected exactly one overload';
  end if;
  if exists (select 1 from information_schema.columns where table_name = 'cafes' and column_name = 'whatsapp_bills_enabled') then
    raise exception 'cafes.whatsapp_bills_enabled should have been dropped';
  end if;
end $$;
