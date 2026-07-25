-- ============================================================================
-- 0088 — Trusted-device registration, replacing the OTP-free login gate
-- (0081/0082/0087) with real phone verification + server-side device trust,
-- per the owner's explicit follow-up spec. This directly answers the
-- question asked before shipping 0087 ("device-only identity, no phone
-- reclaim") — the owner has now chosen real verification instead.
--
-- POLICY: one ACTIVE trusted device per customer per café. Verifying OTP on
-- a new device atomically revokes whichever device was active before.
-- Revoking a device invalidates every session tied to it immediately,
-- server-side — not by trusting the client to forget a localStorage value.
--
-- customer_start_session (0081/0082/0087, no-OTP) is NOT dropped — deleting
-- a shipped migration's function is against this project's convention — but
-- its EXECUTE grant is revoked below. It becomes dead, unreachable code: the
-- only way to start a session now is customer_verify_otp, which requires a
-- real code sent to the phone. Leaving the no-OTP function reachable would
-- make this entire migration pointless — anyone could just keep calling it.
-- ============================================================================

-- ── Trusted devices ──────────────────────────────────────────────────────────
-- No SELECT policy at all, deliberately — same "zero policy = fully locked"
-- pattern as customer_otp_challenges/cafe_payment_secrets/otp_ip_attempts.
-- device_id_hash is a one-way hash of the client's opaque device id; it is
-- never exposed to café staff (not even hashed) per the owner's spec.
create table if not exists customer_devices (
  id             uuid primary key default gen_random_uuid(),
  cafe_id        uuid not null references cafes(id) on delete cascade,
  customer_id    uuid not null references customers(id) on delete cascade,
  device_id_hash text not null,
  status         text not null default 'active' check (status in ('active', 'revoked')),
  created_at     timestamptz not null default now(),
  verified_at    timestamptz not null default now(),
  last_seen_at   timestamptz,
  revoked_at     timestamptz
);
-- Enforces the one-active-device policy at the database level, not just in
-- application logic — a second concurrent verify can never leave two rows
-- active for the same customer.
create unique index if not exists customer_devices_one_active
  on customer_devices (cafe_id, customer_id) where status = 'active';
create index if not exists customer_devices_lookup
  on customer_devices (cafe_id, customer_id, device_id_hash);
alter table customer_devices enable row level security;

-- ── customer_sessions: link each session to the device that created it ─────
alter table customer_sessions add column if not exists device_row_id uuid references customer_devices(id);

-- ── Resolve a session token — now requires the owning device to be active ──
-- Signature/return shape unchanged from 0087; only the WHERE clause tightens.
-- A session whose device was revoked resolves to no row at all, identical to
-- an expired token — every caller (customer_order_history,
-- customer_reorder_payload) already fails closed on that, so revocation
-- takes effect everywhere for free.
create or replace function customer_session_identity(p_session_token text)
returns table (customer_id uuid, cafe_id uuid, device_id text)
language plpgsql stable security definer set search_path = public, extensions as $$
declare v_hash text;
begin
  if p_session_token is null or length(p_session_token) < 32 then return; end if;
  v_hash := encode(digest(p_session_token, 'sha256'), 'hex');

  return query
  select s.customer_id, s.cafe_id, s.device_id
  from customer_sessions s
  join customer_devices d on d.id = s.device_row_id and d.status = 'active'
  where s.token_hash = v_hash
    and s.revoked_at is null
    and s.expires_at > now();
end $$;

revoke execute on function customer_session_identity(text) from public, anon, authenticated;

-- ── Lightweight "is my cached session still good" check ─────────────────────
-- Used on page load so a device that was revoked elsewhere is caught
-- immediately (shows the login gate again) instead of only failing the next
-- time the customer happens to open My Orders.
create or replace function customer_session_status(p_session_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_customer_id uuid;
begin
  select i.customer_id into v_customer_id from customer_session_identity(p_session_token) i;
  return jsonb_build_object('valid', v_customer_id is not null);
end $$;

grant execute on function customer_session_status(text) to anon, authenticated;

-- ── customer_verify_otp: now registers/revokes trusted devices ─────────────
drop function if exists customer_verify_otp(text, text, text);
create function customer_verify_otp(p_table_token text, p_phone text, p_code text, p_device_id text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_cafe_id       uuid;
  v_phone         text;
  v_challenge     record;
  v_customer_id   uuid;
  v_token         text;
  v_device_hash   text;
  v_device_row_id uuid;
  v_new_device    boolean := false;
begin
  select t.cafe_id into v_cafe_id from cafe_tables t where t.token = p_table_token;
  if v_cafe_id is null then raise exception 'invalid table'; end if;

  v_phone := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
  if v_phone is null then raise exception 'invalid phone number'; end if;

  select * into v_challenge from customer_otp_challenges o
    where o.cafe_id = v_cafe_id and o.phone = v_phone and o.consumed_at is null
    order by o.created_at desc limit 1;

  if v_challenge is null or v_challenge.expires_at < now() then
    raise exception 'this code has expired — request a new one';
  end if;

  if v_challenge.attempts >= 5 then
    update customer_otp_challenges set consumed_at = now() where id = v_challenge.id;
    raise exception 'too many incorrect attempts — request a new code';
  end if;

  if v_challenge.code_hash <> crypt(coalesce(p_code, ''), v_challenge.code_hash) then
    update customer_otp_challenges set attempts = attempts + 1 where id = v_challenge.id;
    raise exception 'that code is not correct';
  end if;

  update customer_otp_challenges set consumed_at = now() where id = v_challenge.id;

  -- Reuses the existing customers table — no parallel identity system. This
  -- is the CRM record (v_customer_stats/loyalty/segments), staff-facing and
  -- RLS-protected; device trust below is a separate, additional layer on
  -- top of it, not a replacement for it.
  insert into customers (cafe_id, phone, last_seen) values (v_cafe_id, v_phone, now())
  on conflict (cafe_id, phone) do update set last_seen = now()
  returning id into v_customer_id;

  -- Device trust: one active device per customer per café. A device_id the
  -- client can't supply (storage blocked) gets a fresh random hash each
  -- time, which safely degrades to "no persistent trust" rather than ever
  -- granting it — it can never coincide with a real stored device's hash.
  v_device_hash := encode(
    digest(coalesce(nullif(trim(p_device_id), ''), encode(gen_random_bytes(16), 'hex')), 'sha256'),
    'hex'
  );

  select id into v_device_row_id from customer_devices
    where cafe_id = v_cafe_id and customer_id = v_customer_id
      and device_id_hash = v_device_hash and status = 'active';

  if v_device_row_id is null then
    -- Either genuinely new, or verifying from a different device than the
    -- one currently trusted — either way, only one may stay active.
    update customer_devices set status = 'revoked', revoked_at = now()
      where cafe_id = v_cafe_id and customer_id = v_customer_id and status = 'active';
    insert into customer_devices (cafe_id, customer_id, device_id_hash, status, verified_at, last_seen_at)
      values (v_cafe_id, v_customer_id, v_device_hash, 'active', now(), now())
      returning id into v_device_row_id;
    v_new_device := true;
  else
    update customer_devices set last_seen_at = now() where id = v_device_row_id;
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into customer_sessions (cafe_id, customer_id, token_hash, expires_at, device_id, device_row_id)
  values (v_cafe_id, v_customer_id, encode(digest(v_token, 'sha256'), 'hex'), now() + interval '90 days',
          p_device_id, v_device_row_id);

  return jsonb_build_object(
    'ok', true, 'session_token', v_token, 'customer_id', v_customer_id, 'new_device', v_new_device
  );
end $$;

grant execute on function customer_verify_otp(text, text, text, text) to anon, authenticated;

-- ── Retire the no-OTP login path ────────────────────────────────────────────
revoke execute on function customer_start_session(text, text, text, text) from anon, authenticated;

-- ── Surface trusted-device status to staff without exposing the device
-- itself — a boolean only, matching the spec's "Trusted Device: Active"
-- allowance while keeping hashes/tokens off the CRM entirely.
create or replace view v_customer_stats
with (security_invoker = true) as
with order_stats as (
  select
    o.cafe_id,
    o.customer_id,
    count(distinct coalesce(o.session_id, o.id)) filter (where o.status = 'completed') as visits,
    coalesce(sum(o.total) filter (where o.status = 'completed'), 0)                    as total_spend,
    max(o.created_at) filter (where o.status = 'completed')                            as last_visit
  from orders o
  where o.customer_id is not null
  group by o.cafe_id, o.customer_id
),
item_counts as (
  select o.cafe_id, o.customer_id, oi.name, sum(oi.qty) as qty
  from orders o
  join order_items oi on oi.order_id = o.id
  where o.customer_id is not null and o.status = 'completed'
  group by o.cafe_id, o.customer_id, oi.name
),
favourite as (
  select distinct on (cafe_id, customer_id) cafe_id, customer_id, name as favourite_item
  from item_counts
  order by cafe_id, customer_id, qty desc, name
),
spend_rank as (
  select cafe_id, customer_id,
         percent_rank() over (partition by cafe_id order by total_spend) as spend_pctile
  from order_stats
  where visits > 0
)
select
  c.id                              as customer_id,
  c.cafe_id,
  c.name,
  c.phone,
  c.email,
  coalesce(os.visits, 0)            as visits,
  coalesce(os.total_spend, 0)       as total_spend,
  case when coalesce(os.visits, 0) > 0
       then round(os.total_spend::numeric / os.visits) else 0 end as avg_order_value,
  os.last_visit,
  f.favourite_item,
  coalesce(lb.balance, 0)           as loyalty_points,
  case
    when coalesce(os.visits, 0) >= 2 and os.last_visit < now() - interval '30 days' then 'at_risk'
    when coalesce(os.visits, 0) >= 3 and coalesce(sr.spend_pctile, 0) >= 0.9 then 'vip'
    when coalesce(os.visits, 0) <= 1 then 'new'
    else 'regular'
  end as segment,
  -- Appended at the end, not inserted earlier — CREATE OR REPLACE VIEW
  -- requires every pre-existing column to keep its name AND position;
  -- Postgres reads a column inserted mid-list as a rename of whatever was
  -- there before (this is exactly what failed on the first run of this
  -- migration: "cannot change name of view column segment to
  -- has_trusted_device"). New columns can only ever be added at the end.
  exists(
    select 1 from customer_devices cd
    where cd.cafe_id = c.cafe_id and cd.customer_id = c.id and cd.status = 'active'
  )                                 as has_trusted_device
from customers c
left join order_stats os on os.cafe_id = c.cafe_id and os.customer_id = c.id
left join favourite    f on f.cafe_id = c.cafe_id and f.customer_id = c.id
left join spend_rank   sr on sr.cafe_id = c.cafe_id and sr.customer_id = c.id
left join loyalty_accounts la on la.cafe_id = c.cafe_id and la.customer_id = c.id
left join v_loyalty_balance lb on lb.account_id = la.id;
