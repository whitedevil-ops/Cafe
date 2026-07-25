-- ============================================================================
-- 0064 — Loyalty & Rewards: real earn/redeem, on top of a schema that has
-- existed since day one with zero write logic. The read side was already
-- wired (pos_lookup_customer since 0016, v_customer_stats since 0018 both
-- read v_loyalty_balance) — nothing ever credited or debited it.
--
-- GAP FOUND WHILE BUILDING THIS: `rewards` was never included in 0050's F-01
-- financial lockdown — it still carried "member all", meaning any
-- authenticated café member (cashier, waiter, kitchen) could edit a reward's
-- points_cost directly via the REST API. Closed here, same pattern as every
-- other financial table in that migration.
--
-- WHY A TRIGGER FOR EARNING, NOT ORDER-ENGINE CODE: exactly the precedent
-- set by assign_gst_invoice_number (0037) and deduct_stock_for_order_item
-- (0036) — fires on the payment_status: * -> 'paid' transition, the one
-- choke point every settlement path (POS, Live Tables, Kitchen, QR online
-- payment) already passes through, so place_order/staff_place_order stay
-- unaware of loyalty entirely. Idempotent the same way the GST trigger is:
-- checked BEFORE inserting, so an order that bounces paid -> refunded ->
-- re-settled only ever earns points once.
--
-- SCOPE: 'earn' and 'redeem' (+ a manual 'adjust' for owner/manager
-- corrections) are built. 'expire' (the fourth ledger_kind the schema
-- already anticipates) needs a scheduled job, not just an RPC — a separate
-- infrastructure decision, not built here. Redemption is a standalone staff
-- action (debit points, hand over the reward) rather than an automatic
-- order-total discount — rewards has no rupee `value` column to drive that
-- with, and inventing one wasn't asked for.
-- ============================================================================

-- ── Close the gap: rewards was missed by 0050 ──────────────────────────────
drop policy if exists "member all" on rewards;
create policy "member read" on rewards for select using (is_cafe_member(cafe_id));
revoke insert, update, delete on rewards from authenticated, anon;

-- ── Per-café configuration, off by default (same precedent as auto_deduct_stock) ──
alter table cafes add column if not exists loyalty_enabled boolean not null default false;
alter table cafes add column if not exists loyalty_points_per_100 integer not null default 10 check (loyalty_points_per_100 >= 0);

-- ── Internal helper — never granted to anon/authenticated, only called from
-- other security-definer functions below. ──────────────────────────────────
create or replace function get_or_create_loyalty_account(p_cafe_id uuid, p_customer_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from loyalty_accounts where cafe_id = p_cafe_id and customer_id = p_customer_id;
  if v_id is not null then return v_id; end if;

  insert into loyalty_accounts (cafe_id, customer_id) values (p_cafe_id, p_customer_id)
    on conflict (cafe_id, customer_id) do nothing
    returning id into v_id;

  if v_id is null then
    select id into v_id from loyalty_accounts where cafe_id = p_cafe_id and customer_id = p_customer_id;
  end if;
  return v_id;
end $$;

revoke execute on function get_or_create_loyalty_account(uuid, uuid) from public, anon, authenticated;

-- ── Earn points automatically when an order actually settles ───────────────
create or replace function earn_loyalty_points_on_payment() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_enabled boolean;
  v_rate    integer;
  v_points  integer;
  v_account uuid;
begin
  begin
    if new.customer_id is null then return new; end if;

    -- Idempotent: this order may transition INTO 'paid' more than once
    -- (paid -> refunded -> re-settled) — never earn twice for the same order.
    if exists (select 1 from loyalty_transactions where order_id = new.id and kind = 'earn') then
      return new;
    end if;

    select loyalty_enabled, loyalty_points_per_100 into v_enabled, v_rate
      from cafes where id = new.cafe_id;
    if not coalesce(v_enabled, false) or coalesce(v_rate, 0) <= 0 then return new; end if;

    v_points := round(new.total * v_rate / 100.0);
    if v_points <= 0 then return new; end if;

    v_account := get_or_create_loyalty_account(new.cafe_id, new.customer_id);

    insert into loyalty_transactions (cafe_id, account_id, order_id, kind, points, reason)
    values (new.cafe_id, v_account, new.id, 'earn', v_points, 'Order #' || new.short_code);
  exception when others then
    -- Same rule as stock deduction (0036): bookkeeping can never block or
    -- fail a real payment.
    null;
  end;
  return new;
end $$;

drop trigger if exists trg_earn_loyalty_points on orders;
create trigger trg_earn_loyalty_points
  after update on orders
  for each row
  when (new.payment_status = 'paid' and old.payment_status is distinct from 'paid')
  execute function earn_loyalty_points_on_payment();

-- ── Redeem a reward for a customer, by phone — any staff member, not just
-- owner/manager: honouring points the customer already earned isn't the
-- same kind of discretionary call as a manual discount. ────────────────────
create or replace function redeem_reward(
  p_cafe_id        uuid,
  p_customer_phone text,
  p_reward_id      uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_phone       text;
  v_customer_id uuid;
  v_customer_name text;
  v_account     uuid;
  v_balance     integer;
  v_reward      rewards%rowtype;
begin
  if not is_cafe_member(p_cafe_id) then
    raise exception 'not authorized for this café';
  end if;

  v_phone := nullif(regexp_replace(coalesce(p_customer_phone, ''), '\D', '', 'g'), '');
  if v_phone is null then raise exception 'a customer phone number is required'; end if;

  select id, name into v_customer_id, v_customer_name
    from customers where cafe_id = p_cafe_id and phone = v_phone;
  if v_customer_id is null then raise exception 'no customer found with this phone number'; end if;

  select * into v_reward from rewards where id = p_reward_id and cafe_id = p_cafe_id;
  if v_reward.id is null then raise exception 'reward not found'; end if;
  if not v_reward.active then raise exception 'this reward is no longer available'; end if;

  v_account := get_or_create_loyalty_account(p_cafe_id, v_customer_id);

  select coalesce(sum(points), 0) into v_balance from loyalty_transactions where account_id = v_account;
  if v_balance < v_reward.points_cost then
    raise exception '% has % points — this reward needs %',
      coalesce(v_customer_name, 'this customer'), v_balance, v_reward.points_cost;
  end if;

  insert into loyalty_transactions (cafe_id, account_id, order_id, kind, points, reason)
  values (p_cafe_id, v_account, null, 'redeem', -v_reward.points_cost, 'Redeemed: ' || v_reward.name);

  return jsonb_build_object(
    'reward', v_reward.name, 'points_spent', v_reward.points_cost,
    'remaining_balance', v_balance - v_reward.points_cost);
end $$;

revoke execute on function redeem_reward(uuid, text, uuid) from public, anon;
grant execute on function redeem_reward(uuid, text, uuid) to authenticated;

-- ── Manual correction — genuinely discretionary (goodwill points, fixing a
-- mistake), so owner/manager only, same gate as a POS discount. ────────────
create or replace function adjust_loyalty_points(
  p_cafe_id        uuid,
  p_customer_phone text,
  p_points         integer,
  p_reason         text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role        member_role;
  v_phone       text;
  v_customer_id uuid;
  v_account     uuid;
  v_balance     integer;
begin
  select role into v_role from cafe_members where cafe_id = p_cafe_id and user_id = auth.uid();
  if v_role is null then raise exception 'not authorized for this café'; end if;
  if v_role not in ('owner', 'manager') then
    raise exception 'only an owner or manager can adjust loyalty points';
  end if;

  if p_points is null or p_points = 0 then raise exception 'adjustment must be non-zero'; end if;
  if p_reason is null or trim(p_reason) = '' then raise exception 'a reason is required for a manual adjustment'; end if;

  v_phone := nullif(regexp_replace(coalesce(p_customer_phone, ''), '\D', '', 'g'), '');
  if v_phone is null then raise exception 'a customer phone number is required'; end if;

  select id into v_customer_id from customers where cafe_id = p_cafe_id and phone = v_phone;
  if v_customer_id is null then raise exception 'no customer found with this phone number'; end if;

  v_account := get_or_create_loyalty_account(p_cafe_id, v_customer_id);

  insert into loyalty_transactions (cafe_id, account_id, order_id, kind, points, reason)
  values (p_cafe_id, v_account, null, 'adjust', p_points, trim(p_reason));

  select coalesce(sum(points), 0) into v_balance from loyalty_transactions where account_id = v_account;

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (p_cafe_id, auth.uid(), 'loyalty.adjusted', 'loyalty_accounts', v_account,
          jsonb_build_object('points', p_points, 'reason', trim(p_reason), 'new_balance', v_balance));

  return jsonb_build_object('new_balance', v_balance);
end $$;

revoke execute on function adjust_loyalty_points(uuid, text, integer, text) from public, anon;
grant execute on function adjust_loyalty_points(uuid, text, integer, text) to authenticated;

-- ── Reward management (owner/manager) — same shape as create_coupon/
-- set_coupon_active (0062). ─────────────────────────────────────────────────
create or replace function create_reward(p_cafe_id uuid, p_name text, p_points_cost integer)
returns rewards
language plpgsql security definer set search_path = public as $$
declare
  v_role member_role;
  v_row  rewards%rowtype;
begin
  select role into v_role from cafe_members where cafe_id = p_cafe_id and user_id = auth.uid();
  if v_role is null then raise exception 'not authorized for this café'; end if;
  if v_role not in ('owner', 'manager') then
    raise exception 'only an owner or manager can create rewards';
  end if;

  if p_name is null or trim(p_name) = '' then raise exception 'enter a reward name'; end if;
  if p_points_cost is null or p_points_cost <= 0 then raise exception 'points cost must be greater than 0'; end if;

  insert into rewards (cafe_id, name, points_cost) values (p_cafe_id, trim(p_name), p_points_cost)
  returning * into v_row;

  return v_row;
end $$;

revoke execute on function create_reward(uuid, text, integer) from public, anon;
grant execute on function create_reward(uuid, text, integer) to authenticated;

create or replace function set_reward_active(p_reward_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id uuid;
  v_role    member_role;
begin
  select cafe_id into v_cafe_id from rewards where id = p_reward_id;
  if v_cafe_id is null then raise exception 'reward not found'; end if;

  select role into v_role from cafe_members where cafe_id = v_cafe_id and user_id = auth.uid();
  if v_role is null then raise exception 'not authorized for this café'; end if;
  if v_role not in ('owner', 'manager') then
    raise exception 'only an owner or manager can change a reward''s status';
  end if;

  update rewards set active = p_active where id = p_reward_id;
end $$;

revoke execute on function set_reward_active(uuid, boolean) from public, anon;
grant execute on function set_reward_active(uuid, boolean) to authenticated;
