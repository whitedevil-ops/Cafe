-- ============================================================================
-- 0112 — Enforce the Scale-plan gate (0111) inside the referral functions
-- themselves, not just via the UI hiding the panel.
--
-- This codebase already hit this exact bug once: wallet_start_topup (0091)
-- gated on cafe_has_feature(v_cafe_id, 'wallet'), but cafe_has_feature fails
-- closed for anyone who isn't is_cafe_member()/is_platform_admin() —
-- neither of which is true for an anonymous QR customer session
-- (is_cafe_member checks auth.uid(), which is null there). Fixed in 0092 by
-- inlining the override-then-plan-default precedence directly, minus the
-- membership gate, since the caller's legitimacy is already proven a
-- different way (customer_session_identity(p_session_token) there).
--
-- The referral functions have the exact same shape: customer_referral_state
-- and customer_start_session's referral-attribution block are both
-- anonymous-QR-session callers, and award_referral_reward_on_payment is a
-- system trigger with no auth.uid() at all. All three would have hit 0092's
-- bug if cafe_has_feature were called directly — caught here before
-- shipping, not after. With three call sites (vs wallet's one), the
-- membership-gate-free check is pulled into one small reusable helper
-- instead of copy-pasted three times.
--
-- Entitlement is a ceiling on top of the owner's own on/off switch, not a
-- replacement for it: a café must have BOTH the plan feature AND
-- referral_enabled=true for referral to actually run. Downgrading a café
-- off Scale stops new attribution and future payouts immediately, even for
-- an already-pending referral row — same fail-closed posture wallet_charge_
-- order and refund_to_wallet already use for the 'wallet' feature.
-- ============================================================================

create or replace function cafe_plan_feature(p_cafe_id uuid, p_feature text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_override      boolean;
  v_plan_key      text;
  v_plan_features jsonb;
begin
  select enabled into v_override from cafe_feature_overrides where cafe_id = p_cafe_id and feature_key = p_feature;
  if v_override is not null then return v_override; end if;

  select plan into v_plan_key from cafes where id = p_cafe_id;
  select features into v_plan_features from platform_plans where key = v_plan_key;
  return coalesce((v_plan_features ->> p_feature)::boolean, false);
end $$;
revoke execute on function cafe_plan_feature(uuid, text) from public, anon, authenticated;

-- ── customer_referral_state: no plan feature -> same as owner-disabled ─────
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
  if not coalesce(v_enabled, false) or not cafe_plan_feature(v_cafe_id, 'referral') then
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

-- ── award_referral_reward_on_payment: same additional check at payout ──────
create or replace function award_referral_reward_on_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ref     customer_referrals%rowtype;
  v_enabled boolean;
  v_reward  integer;
begin
  select referral_enabled, referral_reward_amount into v_enabled, v_reward
    from cafes where id = new.cafe_id;
  if not coalesce(v_enabled, false) or not cafe_plan_feature(new.cafe_id, 'referral') then return new; end if;
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
-- Trigger itself is unchanged (same function name, same WHEN clause) —
-- create or replace above is enough, no drop/recreate needed.

-- ── customer_start_session: same base as 0110, plus the plan-feature check
-- alongside the existing referral_enabled check in the attribution block ──
drop function if exists customer_start_session(text, text, text, text, text);
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
    if coalesce(v_referral_enabled, false) and cafe_plan_feature(v_cafe_id, 'referral') and v_ref_code_clean is not null then
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
