-- ============================================================================
-- 0091 — Customer prepaid wallet. Customer tops up online (e.g. pays ₹3000,
-- gets ₹3200 credited — the bonus tiers are owner-configurable, not
-- hardcoded), then spends the balance against future orders at that café
-- only (a closed-loop, single-merchant instrument — deliberately never
-- transferable, cash-out-able, or usable across cafés, which keeps this
-- outside RBI's PPI-authorization requirement for open/semi-closed systems).
--
-- Gated behind the Growth/Scale plans (pro/business keys), same posture as
-- loyalty/coupons in 0073.
--
-- Design choices, and why:
--  * Balance is ledger-derived (sum of wallet_transactions.amount), not a
--    stored column — same pattern as loyalty_transactions. No denormalized
--    balance to drift out of sync with its own history.
--  * Top-up funding is ONLINE-ONLY via the café's own connected Razorpay
--    account (0046) — no cash top-up path, so every credit is backed by a
--    verified webhook, never a staff-entered amount with no gateway proof.
--  * Top-ups reuse `payment_attempts` (0040) rather than a parallel table:
--    a wallet top-up genuinely IS a payment attempt on the café's Razorpay
--    account, and reusing it means the webhook route's proven signature
--    verification / café resolution / idempotency plumbing is untouched —
--    only a new branch is added for the wallet purpose.
--  * Spending is a SEPARATE step after place_order, not baked into it —
--    mirrors how online order payment already works (place the order
--    unpaid, pay it via a follow-up call keyed by receipt_token). This
--    keeps place_order/staff_place_order — the most-evolved, highest-risk
--    functions in this codebase — completely untouched.
--  * Refunds do NOT yet route back to the wallet automatically (they still
--    go through the existing refund_order flow as before) — flagged as a
--    known follow-up, not silently gapped.
-- ============================================================================

alter type payment_method add value if not exists 'wallet';

-- ── Feature gate ────────────────────────────────────────────────────────────
update platform_plans set features = features || '{"wallet": false}'::jsonb where key in ('trial', 'starter');
update platform_plans set features = features || '{"wallet": true}'::jsonb  where key in ('pro', 'business');

-- ── Owner-configured top-up tiers ───────────────────────────────────────────
create table if not exists wallet_topup_tiers (
  id            uuid primary key default gen_random_uuid(),
  cafe_id       uuid not null references cafes(id) on delete cascade,
  pay_amount    integer not null check (pay_amount > 0),
  credit_amount integer not null check (credit_amount >= pay_amount),
  active        boolean not null default true,
  sort          integer not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists wallet_topup_tiers_cafe_idx on wallet_topup_tiers (cafe_id, sort);

alter table wallet_topup_tiers enable row level security;
drop policy if exists "member manage" on wallet_topup_tiers;
drop policy if exists "public read active" on wallet_topup_tiers;
create policy "member manage" on wallet_topup_tiers for all
  using (has_cafe_role(cafe_id, array['owner','manager']::member_role[]))
  with check (has_cafe_role(cafe_id, array['owner','manager']::member_role[]));
-- Customers need to see the tiers to pick one when topping up — same public
-- posture as menu_items (a café's own tiers, not private data).
create policy "public read active" on wallet_topup_tiers for select
  to anon, authenticated using (active);

-- ── The wallet ledger — every balance change, ever, immutable ─────────────
create table if not exists wallet_transactions (
  id                  uuid primary key default gen_random_uuid(),
  cafe_id             uuid not null references cafes(id) on delete cascade,
  customer_id         uuid not null references customers(id) on delete cascade,
  kind                text not null check (kind in ('topup', 'spend', 'adjustment')),
  amount              integer not null check (amount <> 0), -- positive = credit, negative = debit
  order_id            uuid references orders(id) on delete set null,
  topup_tier_id       uuid references wallet_topup_tiers(id) on delete set null,
  provider_payment_id text,
  reason              text,
  created_by          uuid references profiles(id) on delete set null, -- set only for manual adjustments
  created_at          timestamptz not null default now()
);
create index if not exists wallet_transactions_customer_idx on wallet_transactions (cafe_id, customer_id, created_at desc);

alter table wallet_transactions enable row level security;
drop policy if exists "member read" on wallet_transactions;
create policy "member read" on wallet_transactions for select using (is_cafe_member(cafe_id));
-- No insert/update/delete policy — every write goes through a SECURITY
-- DEFINER function below, so a balance can never be forged via a direct write.

-- ── payment_attempts becomes polymorphic: an order payment OR a wallet
-- top-up. order_id was already nullable, so this only adds the branch. ─────
alter table payment_attempts add column if not exists purpose       text not null default 'order';
alter table payment_attempts add column if not exists customer_id   uuid references customers(id) on delete cascade;
alter table payment_attempts add column if not exists wallet_tier_id uuid references wallet_topup_tiers(id);
do $$ begin
  alter table payment_attempts add constraint payment_attempts_purpose_chk
    check (purpose in ('order', 'wallet_topup'));
exception when duplicate_object then null; end $$;

-- ── Balance (staff-facing, any café member) ─────────────────────────────────
create or replace function wallet_balance_for_customer(p_cafe_id uuid, p_customer_id uuid)
returns integer language plpgsql stable security definer set search_path = public as $$
begin
  if not is_cafe_member(p_cafe_id) then raise exception 'not authorized for this café'; end if;
  return coalesce((select sum(amount) from wallet_transactions
    where cafe_id = p_cafe_id and customer_id = p_customer_id), 0);
end $$;
revoke execute on function wallet_balance_for_customer(uuid, uuid) from public, anon;
grant execute on function wallet_balance_for_customer(uuid, uuid) to authenticated;

-- ── Balance + recent history (customer-facing, via QR session) ─────────────
create or replace function customer_wallet_state(p_session_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_customer_id uuid;
  v_cafe_id     uuid;
  v_balance     integer;
  v_history     jsonb;
begin
  select customer_id, cafe_id into v_customer_id, v_cafe_id
    from customer_session_identity(p_session_token);
  if v_customer_id is null then raise exception 'session expired — please log in again'; end if;

  v_balance := coalesce((select sum(amount) from wallet_transactions
    where cafe_id = v_cafe_id and customer_id = v_customer_id), 0);

  select coalesce(jsonb_agg(jsonb_build_object(
      'kind', kind, 'amount', amount, 'created_at', created_at
    ) order by created_at desc), '[]'::jsonb)
    into v_history
    from (select * from wallet_transactions
          where cafe_id = v_cafe_id and customer_id = v_customer_id
          order by created_at desc limit 20) t;

  return jsonb_build_object('balance', v_balance, 'history', v_history);
end $$;
grant execute on function customer_wallet_state(text) to anon, authenticated;

-- ── Start a top-up: validates the tier, opens a pending attempt ────────────
create or replace function wallet_start_topup(p_session_token text, p_tier_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_customer_id uuid;
  v_cafe_id     uuid;
  v_tier        wallet_topup_tiers%rowtype;
  v_attempt_id  uuid;
begin
  select customer_id, cafe_id into v_customer_id, v_cafe_id
    from customer_session_identity(p_session_token);
  if v_customer_id is null then raise exception 'session expired — please log in again'; end if;

  if not cafe_has_feature(v_cafe_id, 'wallet') then
    raise exception 'wallet top-ups are not available at this café';
  end if;

  select * into v_tier from wallet_topup_tiers where id = p_tier_id and cafe_id = v_cafe_id and active;
  if v_tier.id is null then raise exception 'this top-up option is no longer available'; end if;

  insert into payment_attempts (cafe_id, customer_id, purpose, wallet_tier_id, amount, method, status)
  values (v_cafe_id, v_customer_id, 'wallet_topup', v_tier.id, v_tier.pay_amount, 'upi', 'initiated')
  returning id into v_attempt_id;

  return jsonb_build_object(
    'attempt_id', v_attempt_id, 'cafe_id', v_cafe_id,
    'pay_amount', v_tier.pay_amount, 'credit_amount', v_tier.credit_amount);
end $$;
grant execute on function wallet_start_topup(text, uuid) to anon, authenticated;

-- ── Confirm a top-up (webhook only — service_role, via the authenticated
-- grant + admin client, exactly like recompute_order_payment_status). ──────
create or replace function wallet_confirm_topup(p_attempt_id uuid, p_provider_payment_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_attempt payment_attempts%rowtype;
  v_tier    wallet_topup_tiers%rowtype;
begin
  select * into v_attempt from payment_attempts where id = p_attempt_id and purpose = 'wallet_topup';
  if v_attempt.id is null then raise exception 'top-up attempt not found'; end if;

  -- Idempotent: a duplicate webhook delivery for an already-confirmed
  -- attempt is a silent no-op, not a double credit.
  if v_attempt.status = 'confirmed' then return; end if;

  perform pg_advisory_xact_lock(hashtext('wallet:' || v_attempt.cafe_id::text || ':' || v_attempt.customer_id::text));

  select * into v_tier from wallet_topup_tiers where id = v_attempt.wallet_tier_id;
  if v_tier.id is null then raise exception 'top-up tier no longer exists'; end if;

  insert into wallet_transactions (cafe_id, customer_id, kind, amount, topup_tier_id, provider_payment_id, reason)
  values (v_attempt.cafe_id, v_attempt.customer_id, 'topup', v_tier.credit_amount, v_tier.id, p_provider_payment_id,
          'Top-up: paid ₹' || v_tier.pay_amount || ', credited ₹' || v_tier.credit_amount);

  update payment_attempts
     set status = 'confirmed', confirmed_at = now(), provider_payment_id = p_provider_payment_id
   where id = p_attempt_id;
end $$;
revoke execute on function wallet_confirm_topup(uuid, text) from public, anon;
grant execute on function wallet_confirm_topup(uuid, text) to authenticated;

-- ── Shared charge logic (not exposed directly — both spend paths below
-- delegate here once they've each resolved who's paying). ──────────────────
create or replace function wallet_charge_order(p_cafe_id uuid, p_customer_id uuid, p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_order   record;
  v_paid    integer;
  v_due     integer;
  v_balance integer;
  v_payment_id uuid;
begin
  select id, total, cafe_id, customer_id into v_order from orders where id = p_order_id and cafe_id = p_cafe_id;
  if v_order.id is null then raise exception 'order not found'; end if;
  if v_order.customer_id is distinct from p_customer_id then
    raise exception 'this order is not linked to this wallet';
  end if;

  -- Lock BEFORE computing what's due, not after — otherwise two concurrent
  -- calls for the same order (a network retry, a double-tap) could both
  -- read "amount due" before either has paid, then both charge the wallet
  -- once the lock serializes them, double-charging for one order. Locking
  -- first means the second call re-reads payments AFTER the first one's
  -- insert has landed, so it correctly sees the order as already paid.
  perform pg_advisory_xact_lock(hashtext('wallet:' || p_cafe_id::text || ':' || p_customer_id::text));

  select coalesce(sum(amount), 0) into v_paid from payments where order_id = p_order_id;
  v_due := v_order.total - v_paid;
  if v_due <= 0 then raise exception 'this order is already paid'; end if;

  v_balance := coalesce((select sum(amount) from wallet_transactions
    where cafe_id = p_cafe_id and customer_id = p_customer_id), 0);
  if v_balance < v_due then
    raise exception 'wallet balance (₹%) is less than the amount due (₹%)', v_balance, v_due;
  end if;

  insert into wallet_transactions (cafe_id, customer_id, kind, amount, order_id, reason)
  values (p_cafe_id, p_customer_id, 'spend', -v_due, p_order_id, 'Order payment');

  insert into payments (cafe_id, order_id, method, amount, source, status, verified_at)
  values (p_cafe_id, p_order_id, 'wallet', v_due, 'wallet', 'captured', now())
  returning id into v_payment_id;

  perform recompute_order_payment_status(p_order_id);

  return jsonb_build_object('paid', v_due, 'new_balance', v_balance - v_due, 'payment_id', v_payment_id);
end $$;
-- Intentionally not granted to anyone — only called internally, from the
-- two functions below, which run with the same SECURITY DEFINER rights.
revoke execute on function wallet_charge_order(uuid, uuid, uuid) from public, anon, authenticated;

-- ── Customer self-checkout: pay an order from their own wallet ─────────────
create or replace function wallet_pay_order(p_session_token text, p_receipt_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_customer_id uuid;
  v_cafe_id     uuid;
  v_order_id    uuid;
begin
  select customer_id, cafe_id into v_customer_id, v_cafe_id
    from customer_session_identity(p_session_token);
  if v_customer_id is null then raise exception 'session expired — please log in again'; end if;

  select id into v_order_id from orders where receipt_token = p_receipt_token and cafe_id = v_cafe_id;
  if v_order_id is null then raise exception 'order not found'; end if;

  return wallet_charge_order(v_cafe_id, v_customer_id, v_order_id);
end $$;
grant execute on function wallet_pay_order(text, uuid) to anon, authenticated;

-- ── Staff-initiated: pay an order from a customer's wallet by phone (POS) ──
create or replace function wallet_pay_for_order(p_cafe_id uuid, p_customer_phone text, p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_phone       text;
  v_customer_id uuid;
begin
  if not is_cafe_member(p_cafe_id) then raise exception 'not authorized for this café'; end if;

  v_phone := nullif(regexp_replace(coalesce(p_customer_phone, ''), '\D', '', 'g'), '');
  if v_phone is null then raise exception 'a customer phone number is required'; end if;

  select id into v_customer_id from customers where cafe_id = p_cafe_id and phone = v_phone;
  if v_customer_id is null then raise exception 'no customer found with this phone number'; end if;

  return wallet_charge_order(p_cafe_id, v_customer_id, p_order_id);
end $$;
revoke execute on function wallet_pay_for_order(uuid, text, uuid) from public, anon;
grant execute on function wallet_pay_for_order(uuid, text, uuid) to authenticated;

-- ── Tier management (owner/manager) — create + soft-toggle, no hard delete,
-- so a retired tier's id stays valid on historical wallet_transactions rows. ─
create or replace function create_wallet_tier(p_cafe_id uuid, p_pay_amount integer, p_credit_amount integer)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not has_cafe_role(p_cafe_id, array['owner','manager']::member_role[]) then
    raise exception 'only an owner or manager can manage wallet top-up tiers';
  end if;
  if p_pay_amount <= 0 then raise exception 'pay amount must be positive'; end if;
  if p_credit_amount < p_pay_amount then raise exception 'credit amount cannot be less than the pay amount'; end if;

  insert into wallet_topup_tiers (cafe_id, pay_amount, credit_amount, sort)
  values (p_cafe_id, p_pay_amount, p_credit_amount,
          coalesce((select max(sort) + 1 from wallet_topup_tiers where cafe_id = p_cafe_id), 0))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function create_wallet_tier(uuid, integer, integer) from public, anon;
grant execute on function create_wallet_tier(uuid, integer, integer) to authenticated;

create or replace function set_wallet_tier_active(p_tier_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_cafe_id uuid;
begin
  select cafe_id into v_cafe_id from wallet_topup_tiers where id = p_tier_id;
  if v_cafe_id is null then raise exception 'tier not found'; end if;
  if not has_cafe_role(v_cafe_id, array['owner','manager']::member_role[]) then
    raise exception 'only an owner or manager can manage wallet top-up tiers';
  end if;
  update wallet_topup_tiers set active = p_active where id = p_tier_id;
end $$;
revoke execute on function set_wallet_tier_active(uuid, boolean) from public, anon;
grant execute on function set_wallet_tier_active(uuid, boolean) to authenticated;

-- ── Manual adjustment (owner/manager only — goodwill credit / correction) ──
create or replace function wallet_adjust(p_cafe_id uuid, p_customer_id uuid, p_amount integer, p_reason text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_balance integer;
begin
  if not has_cafe_role(p_cafe_id, array['owner','manager']::member_role[]) then
    raise exception 'only an owner or manager can adjust a wallet balance';
  end if;
  if p_amount = 0 then raise exception 'amount cannot be zero'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'a reason is required'; end if;

  perform pg_advisory_xact_lock(hashtext('wallet:' || p_cafe_id::text || ':' || p_customer_id::text));

  insert into wallet_transactions (cafe_id, customer_id, kind, amount, reason, created_by)
  values (p_cafe_id, p_customer_id, 'adjustment', p_amount, trim(p_reason), auth.uid());

  select coalesce(sum(amount), 0) into v_balance from wallet_transactions
    where cafe_id = p_cafe_id and customer_id = p_customer_id;
  return v_balance;
end $$;
revoke execute on function wallet_adjust(uuid, uuid, integer, text) from public, anon;
grant execute on function wallet_adjust(uuid, uuid, integer, text) to authenticated;

-- ── Owner overview: every customer with a nonzero balance + the platform's
-- total outstanding liability (money owed to customers as stored value). ───
create or replace function wallet_overview(p_cafe_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_total    integer;
  v_wallets  jsonb;
begin
  if not is_cafe_member(p_cafe_id) then raise exception 'not authorized for this café'; end if;

  select coalesce(sum(amount), 0) into v_total from wallet_transactions where cafe_id = p_cafe_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'customer_id', customer_id, 'name', name, 'phone', phone, 'balance', balance
    ) order by balance desc), '[]'::jsonb)
    into v_wallets
    from (
      select c.id as customer_id, c.name, c.phone, sum(wt.amount) as balance
      from wallet_transactions wt join customers c on c.id = wt.customer_id
      where wt.cafe_id = p_cafe_id
      group by c.id, c.name, c.phone
      having sum(wt.amount) <> 0
      order by sum(wt.amount) desc
      limit 200
    ) s;

  return jsonb_build_object('total_outstanding', v_total, 'wallets', v_wallets);
end $$;
revoke execute on function wallet_overview(uuid) from public, anon;
grant execute on function wallet_overview(uuid) to authenticated;
