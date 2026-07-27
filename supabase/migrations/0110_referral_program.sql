-- ============================================================================
-- 0110 — Referral program. A customer shares their code; when whoever they
-- referred pays for their FIRST order at this café, both get a wallet
-- credit. Off by default per café, owner sets the reward amount.
--
-- Design choices, and why:
--  * A referral is recorded at signup (customer_start_session, new param
--    p_ref_code) but only PAID at the referee's first payment-confirmed
--    order — mirrors the loyalty-earn trigger's chokepoint
--    (payment_status → 'paid'), the proven pattern in this codebase for
--    "this order is now real money", not the kitchen/service status column
--    (which has no single trigger point — see 0107/0108's research).
--  * "First order" needs no separate counting logic: the referral row is
--    created once, 'pending', and the reward trigger flips it to
--    'rewarded' and never matches a 'pending' row for that referee again —
--    the status transition itself IS the idempotency guard.
--  * Reward pays through wallet_transactions directly (kind='adjustment'),
--    the same shape wallet_adjust uses — not wallet_adjust itself, since
--    that RPC requires a real staff auth.uid() with an owner/manager role,
--    and this fires from a system trigger with neither.
--  * referral_code lives on customers (nullable, generated on first ask)
--    rather than a separate codes table — one code per customer is all
--    this needs, and customers is already the phone-scoped identity table.
--  * No plan-tier gate (unlike wallet/loyalty/coupons) — this is a single
--    owner-facing on/off switch, not a premium analytics surface, so it
--    doesn't touch the entitlements system.
-- ============================================================================

alter table cafes add column if not exists referral_enabled boolean not null default false;
alter table cafes add column if not exists referral_reward_amount integer not null default 50 check (referral_reward_amount >= 0);

alter table customers add column if not exists referral_code text;
create unique index if not exists customers_referral_code_key on customers (referral_code) where referral_code is not null;

create table if not exists customer_referrals (
  id                    uuid primary key default gen_random_uuid(),
  cafe_id               uuid not null references cafes(id) on delete cascade,
  referrer_customer_id  uuid not null references customers(id) on delete cascade,
  referee_customer_id   uuid not null references customers(id) on delete cascade,
  status                text not null default 'pending' check (status in ('pending', 'rewarded')),
  reward_amount         integer,
  rewarded_at           timestamptz,
  created_at            timestamptz not null default now(),
  constraint customer_referrals_no_self_referral check (referrer_customer_id <> referee_customer_id),
  unique (cafe_id, referee_customer_id)
);
create index if not exists customer_referrals_referrer_idx on customer_referrals (cafe_id, referrer_customer_id);

alter table customer_referrals enable row level security;
drop policy if exists "member read" on customer_referrals;
create policy "member read" on customer_referrals for select using (is_cafe_member(cafe_id));
-- No insert/update/delete policy — every write goes through a SECURITY
-- DEFINER function below, same posture as wallet_transactions/loyalty_transactions.

-- ── Customer-facing: balance/code/stats for the Wallet page's referral card ─
create or replace function customer_referral_state(p_session_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_customer_id uuid;
  v_cafe_id     uuid;
  v_enabled     boolean;
  v_reward      integer;
  v_code        text;
  v_referred    integer;
  v_rewarded    integer;
begin
  select customer_id, cafe_id into v_customer_id, v_cafe_id
    from customer_session_identity(p_session_token);
  if v_customer_id is null then raise exception 'session expired — please log in again'; end if;

  select referral_enabled, referral_reward_amount into v_enabled, v_reward
    from cafes where id = v_cafe_id;
  if not coalesce(v_enabled, false) then
    return jsonb_build_object('enabled', false);
  end if;

  select referral_code into v_code from customers where id = v_customer_id;
  if v_code is null then
    loop
      v_code := upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6));
      begin
        update customers set referral_code = v_code where id = v_customer_id;
        exit;
      exception when unique_violation then
        -- collision on the shared partial-unique index — try another code
      end;
    end loop;
  end if;

  select count(*) into v_referred from customer_referrals
    where cafe_id = v_cafe_id and referrer_customer_id = v_customer_id;
  select count(*) into v_rewarded from customer_referrals
    where cafe_id = v_cafe_id and referrer_customer_id = v_customer_id and status = 'rewarded';

  return jsonb_build_object(
    'enabled', true, 'reward_amount', v_reward, 'code', v_code,
    'referred_count', v_referred, 'rewarded_count', v_rewarded
  );
end $$;
grant execute on function customer_referral_state(text) to anon, authenticated;

-- ── Staff-facing: recent referral activity for the owner's Loyalty page ────
create or replace function list_referrals(p_cafe_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not is_cafe_member(p_cafe_id) then raise exception 'not authorized for this café'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'referrer_name', rc.name, 'referrer_phone', rc.phone,
      'referee_name', ee.name, 'referee_phone', ee.phone,
      'status', r.status, 'reward_amount', r.reward_amount,
      'created_at', r.created_at, 'rewarded_at', r.rewarded_at
    ) order by r.created_at desc), '[]'::jsonb)
    into v_result
    from customer_referrals r
    join customers rc on rc.id = r.referrer_customer_id
    join customers ee on ee.id = r.referee_customer_id
    where r.cafe_id = p_cafe_id
    limit 200;

  return v_result;
end $$;
revoke execute on function list_referrals(uuid) from public, anon;
grant execute on function list_referrals(uuid) to authenticated;

-- ── Payout trigger — same chokepoint pattern as trg_earn_loyalty_points ────
create or replace function award_referral_reward_on_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ref     customer_referrals%rowtype;
  v_enabled boolean;
  v_reward  integer;
begin
  select referral_enabled, referral_reward_amount into v_enabled, v_reward
    from cafes where id = new.cafe_id;
  if not coalesce(v_enabled, false) then return new; end if;
  if new.customer_id is null then return new; end if;

  select * into v_ref from customer_referrals
    where cafe_id = new.cafe_id and referee_customer_id = new.customer_id and status = 'pending'
    limit 1;
  if v_ref.id is null then return new; end if;

  insert into wallet_transactions (cafe_id, customer_id, kind, amount, order_id, reason)
  values
    (new.cafe_id, v_ref.referrer_customer_id, 'adjustment', v_reward, new.id, 'Referral reward — invited a friend'),
    (new.cafe_id, v_ref.referee_customer_id,  'adjustment', v_reward, new.id, 'Referral reward — welcome bonus');

  update customer_referrals
    set status = 'rewarded', reward_amount = v_reward, rewarded_at = now()
    where id = v_ref.id;

  return new;
end $$;

drop trigger if exists trg_award_referral_reward on orders;
create trigger trg_award_referral_reward
  after update on orders
  for each row
  when (new.payment_status = 'paid' and old.payment_status is distinct from 'paid')
  execute function award_referral_reward_on_payment();

-- ── customer_start_session — recreated verbatim from 0089, plus a new
-- optional p_ref_code param. Signature changes (4 args → 5), so the old
-- overload must be dropped explicitly, not just replaced. ──────────────────
drop function if exists customer_start_session(text, text, text, text);
create function customer_start_session(p_table_token text, p_phone text, p_name text, p_device_id text default null, p_ref_code text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_cafe_id         uuid;
  v_status          text;
  v_phone           text;
  v_name            text;
  v_customer_id     uuid;
  v_is_new          boolean;
  v_recent          integer;
  v_token           text;
  v_device_hash     text;
  v_device_row_id   uuid;
  v_referral_enabled boolean;
  v_ref_code_clean  text;
  v_referrer_id     uuid;
begin
  select t.cafe_id into v_cafe_id from cafe_tables t where t.token = p_table_token;
  if v_cafe_id is null then raise exception 'invalid table'; end if;

  select status into v_status from cafes where id = v_cafe_id;
  if v_status <> 'active' then raise exception 'this café is not currently active'; end if;

  v_phone := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
  if v_phone is null or v_phone !~ '^[6-9][0-9]{9}$' then raise exception 'invalid phone number'; end if;

  v_name := nullif(trim(coalesce(p_name, '')), '');
  if v_name is null then raise exception 'name is required'; end if;

  select count(*) into v_recent from customer_sessions s
    join customers c on c.id = s.customer_id
    where c.cafe_id = v_cafe_id and c.phone = v_phone and s.created_at > now() - interval '1 hour';
  if v_recent >= 5 then
    raise exception 'too many attempts for this number — please try again in a while';
  end if;

  -- CRM identity — unchanged, still just a phone-keyed upsert. (xmax = 0)
  -- tells us whether this row was just inserted (a brand-new customer) or
  -- merely updated (a returning one) — needed to gate referral attribution
  -- to first-time signups only.
  insert into customers (cafe_id, phone, name, last_seen)
  values (v_cafe_id, v_phone, v_name, now())
  on conflict (cafe_id, phone) do update set name = v_name, last_seen = now()
  returning id, (xmax = 0) into v_customer_id, v_is_new;

  if v_is_new then
    select referral_enabled into v_referral_enabled from cafes where id = v_cafe_id;
    v_ref_code_clean := nullif(upper(trim(coalesce(p_ref_code, ''))), '');
    if coalesce(v_referral_enabled, false) and v_ref_code_clean is not null then
      select id into v_referrer_id from customers
        where cafe_id = v_cafe_id and referral_code = v_ref_code_clean;
      if v_referrer_id is not null and v_referrer_id <> v_customer_id then
        insert into customer_referrals (cafe_id, referrer_customer_id, referee_customer_id)
        values (v_cafe_id, v_referrer_id, v_customer_id)
        on conflict (cafe_id, referee_customer_id) do nothing;
      end if;
    end if;
  end if;

  -- Same device-trust bookkeeping customer_verify_otp uses (one active
  -- device per customer per café), minus the OTP gate — a device switch
  -- still revokes the previous one, it just isn't proven by a code yet.
  v_device_hash := encode(
    digest(coalesce(nullif(trim(p_device_id), ''), encode(gen_random_bytes(16), 'hex')), 'sha256'),
    'hex'
  );

  select id into v_device_row_id from customer_devices
    where cafe_id = v_cafe_id and customer_id = v_customer_id
      and device_id_hash = v_device_hash and status = 'active';

  if v_device_row_id is null then
    update customer_devices set status = 'revoked', revoked_at = now()
      where cafe_id = v_cafe_id and customer_id = v_customer_id and status = 'active';
    insert into customer_devices (cafe_id, customer_id, device_id_hash, status, verified_at, last_seen_at)
      values (v_cafe_id, v_customer_id, v_device_hash, 'active', now(), now())
      returning id into v_device_row_id;
  else
    update customer_devices set last_seen_at = now() where id = v_device_row_id;
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into customer_sessions (cafe_id, customer_id, token_hash, expires_at, device_id, device_row_id)
  values (v_cafe_id, v_customer_id, encode(digest(v_token, 'sha256'), 'hex'), now() + interval '90 days',
          p_device_id, v_device_row_id);

  return jsonb_build_object('ok', true, 'session_token', v_token, 'customer_id', v_customer_id, 'name', v_name, 'phone', v_phone);
end $$;

revoke execute on function customer_start_session(text, text, text, text, text) from public, anon;
grant execute on function customer_start_session(text, text, text, text, text) to anon, authenticated;
