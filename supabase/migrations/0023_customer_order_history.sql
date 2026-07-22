-- ============================================================================
-- 0023 — Persistent customer order history for QR ordering, gated behind real
-- phone verification.
--
-- THREAT MODEL (the reason this is not just "look up orders by phone"):
-- order history reveals what a person ate, when, where, with what frequency,
-- and how much they spend. Handing that to anyone who types a 10-digit number
-- is a privacy breach, and phone numbers are trivially guessable/enumerable.
-- So: typing a phone number proves nothing. Possessing a code sent TO that
-- number proves something. Only the latter unlocks history.
--
-- DELIBERATE SPLIT — placing an order does NOT require OTP:
--   * Placing an order: unchanged. You type your own number to get your own
--     bill. Nothing is disclosed to you that you did not just create.
--   * Viewing history: requires a verified session. This is the only path
--     that discloses past data.
-- Making OTP mandatory to ORDER would take QR ordering completely offline
-- whenever SMS delivery is down — trading a working revenue path for a
-- convenience feature. Never worth it.
--
-- Browser storage holds only an opaque server-issued token. The database is
-- the source of truth: the token is meaningless without a live, unexpired,
-- unrevoked row here, and it is stored HASHED so a database leak does not
-- hand out working sessions.
-- ============================================================================

-- ── OTP challenges ─────────────────────────────────────────────────────────
-- No RLS policy is created for anon/authenticated deliberately: nothing may
-- read or write this table directly. Only the SECURITY DEFINER functions
-- below touch it, so codes and attempt counts cannot be probed from a client.
create table if not exists customer_otp_challenges (
  id           uuid primary key default gen_random_uuid(),
  cafe_id      uuid not null references cafes(id) on delete cascade,
  phone        text not null,
  code_hash    text not null,                -- crypt()ed; the code itself is never stored
  attempts     integer not null default 0,
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists otp_lookup_idx on customer_otp_challenges (cafe_id, phone, created_at desc);
alter table customer_otp_challenges enable row level security;

-- ── Verified customer sessions ─────────────────────────────────────────────
create table if not exists customer_sessions (
  id           uuid primary key default gen_random_uuid(),
  cafe_id      uuid not null references cafes(id) on delete cascade,
  customer_id  uuid not null references customers(id) on delete cascade,
  token_hash   text not null unique,         -- sha256 of the token the client holds
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index if not exists customer_sessions_customer_idx on customer_sessions (customer_id);
alter table customer_sessions enable row level security;
-- Staff may see that sessions exist for their own café (support/debugging),
-- but token_hash is useless to them and grants nothing.
create policy "member read" on customer_sessions for select using (is_cafe_member(cafe_id));

-- ── Internal helper: resolve a raw session token to (customer, café) ───────
create or replace function customer_session_identity(p_session_token text)
returns table (customer_id uuid, cafe_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare v_hash text;
begin
  if p_session_token is null or length(p_session_token) < 32 then return; end if;
  v_hash := encode(digest(p_session_token, 'sha256'), 'hex');

  return query
  select s.customer_id, s.cafe_id
  from customer_sessions s
  where s.token_hash = v_hash
    and s.revoked_at is null
    and s.expires_at > now();
end $$;

revoke execute on function customer_session_identity(text) from public, anon, authenticated;

-- ── Step 1: issue an OTP challenge ─────────────────────────────────────────
-- The code is generated HERE, not accepted as a parameter. If the caller could
-- choose the code, anyone able to reach this function could set a known code
-- for someone else's phone number and then "verify" as them — the whole point
-- of the OTP would collapse. Generating it server-side removes that entirely.
--
-- Returns the plaintext code so the Next.js route can SMS it, and is therefore
-- granted to service_role ONLY — never anon. Rate-limited per phone+café so it
-- cannot be used to spam a handset or to churn fresh codes for brute forcing.
create or replace function customer_issue_otp(p_table_token text, p_phone text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id uuid;
  v_status  text;
  v_phone   text;
  v_recent  integer;
  v_code    text;
begin
  select t.cafe_id into v_cafe_id from cafe_tables t where t.token = p_table_token;
  if v_cafe_id is null then raise exception 'invalid table'; end if;

  select c.status into v_status from cafes c where c.id = v_cafe_id;
  if v_status <> 'active' then raise exception 'this café is not currently active'; end if;

  v_phone := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
  if v_phone is null or v_phone !~ '^[6-9][0-9]{9}$' then raise exception 'invalid phone number'; end if;

  select count(*) into v_recent from customer_otp_challenges o
    where o.cafe_id = v_cafe_id and o.phone = v_phone and o.created_at > now() - interval '15 minutes';
  if v_recent >= 3 then
    raise exception 'too many codes requested — please wait a few minutes before trying again';
  end if;

  -- Any earlier live challenge for this number is retired, so only the newest
  -- code can ever work.
  update customer_otp_challenges set consumed_at = now()
    where cafe_id = v_cafe_id and phone = v_phone and consumed_at is null;

  -- 6 digits from pgcrypto's CSPRNG, zero-padded so every code is 6 chars.
  v_code := lpad(((get_byte(gen_random_bytes(4), 0)::bigint << 24
                 | get_byte(gen_random_bytes(4), 0)::bigint << 16
                 | get_byte(gen_random_bytes(4), 0)::bigint << 8
                 | get_byte(gen_random_bytes(4), 0)::bigint) % 1000000)::text, 6, '0');

  insert into customer_otp_challenges (cafe_id, phone, code_hash, expires_at)
  values (v_cafe_id, v_phone, crypt(v_code, gen_salt('bf')), now() + interval '10 minutes');

  return jsonb_build_object('ok', true, 'phone', v_phone, 'code', v_code, 'expires_in_seconds', 600);
end $$;

-- service_role ONLY. Anon must never reach this: it returns the plaintext code.
revoke execute on function customer_issue_otp(text, text) from public, anon, authenticated;
grant execute on function customer_issue_otp(text, text) to service_role;

-- ── Step 2: verify the code, mint a session ────────────────────────────────
create or replace function customer_verify_otp(p_table_token text, p_phone text, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id     uuid;
  v_phone       text;
  v_challenge   record;
  v_customer_id uuid;
  v_token       text;
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

  -- Reuses the existing customers table — no parallel identity system.
  insert into customers (cafe_id, phone, last_seen) values (v_cafe_id, v_phone, now())
  on conflict (cafe_id, phone) do update set last_seen = now()
  returning id into v_customer_id;

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into customer_sessions (cafe_id, customer_id, token_hash, expires_at)
  values (v_cafe_id, v_customer_id, encode(digest(v_token, 'sha256'), 'hex'), now() + interval '90 days');

  return jsonb_build_object('ok', true, 'session_token', v_token, 'customer_id', v_customer_id);
end $$;

grant execute on function customer_verify_otp(text, text, text) to anon, authenticated;

-- ── Step 3: the history itself ─────────────────────────────────────────────
-- Takes ONLY the session token. The client never supplies a customer_id or
-- phone number, so it cannot ask for anyone else's orders; identity is
-- resolved server-side from the token and both customer_id AND cafe_id are
-- applied as filters, keeping tenant isolation intact.
create or replace function customer_order_history(
  p_session_token text, p_limit integer default 10, p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_customer_id uuid;
  v_cafe_id     uuid;
  v_limit       integer := least(greatest(coalesce(p_limit, 10), 1), 50);
  v_total       integer;
begin
  select i.customer_id, i.cafe_id into v_customer_id, v_cafe_id
    from customer_session_identity(p_session_token) i;
  if v_customer_id is null then raise exception 'session expired — please verify your number again'; end if;

  select count(*) into v_total from orders o
    where o.customer_id = v_customer_id and o.cafe_id = v_cafe_id and o.status <> 'cancelled';

  return jsonb_build_object(
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
        where o.customer_id = v_customer_id and o.cafe_id = v_cafe_id and o.status <> 'cancelled'
        order by o.created_at desc
        limit v_limit offset greatest(coalesce(p_offset, 0), 0)
      ) x
    ), '[]'::jsonb)
  );
end $$;

grant execute on function customer_order_history(text, integer, integer) to anon, authenticated;

-- ── Reorder: rebuild a cart payload from a past order ──────────────────────
-- Returns a cart the client feeds into the EXISTING place_order — no second
-- order-creation path. Prices are never taken from the old order: the client
-- gets item ids, and place_order re-reads today's prices server-side as
-- always. Variants/add-ons are matched back by name against the live menu,
-- and anything since removed or marked unavailable is reported rather than
-- silently dropped.
create or replace function customer_reorder_payload(p_session_token text, p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_customer_id uuid;
  v_cafe_id     uuid;
  v_owner       uuid;
begin
  select i.customer_id, i.cafe_id into v_customer_id, v_cafe_id
    from customer_session_identity(p_session_token) i;
  if v_customer_id is null then raise exception 'session expired — please verify your number again'; end if;

  select o.customer_id into v_owner from orders o
    where o.id = p_order_id and o.cafe_id = v_cafe_id;
  if v_owner is null or v_owner <> v_customer_id then raise exception 'order not found'; end if;

  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'item_id',    mi.id,
        'name',       mi.name,
        'qty',        oi.qty,
        'available',  (mi.available and not mi.archived),
        'variant_id', (
          select v.id from menu_item_variants v
          where v.menu_item_id = mi.id
            and v.name in (select jsonb_array_elements(oi.modifiers) ->> 'name')
          limit 1
        ),
        'addon_ids', coalesce((
          select jsonb_agg(a.id) from menu_item_addons a
          where a.menu_item_id = mi.id
            and a.name in (select jsonb_array_elements(oi.modifiers) ->> 'name')
        ), '[]'::jsonb)
      ) order by oi.id)
      from order_items oi
      join menu_items mi on mi.id = oi.menu_item_id
      where oi.order_id = p_order_id
    ), '[]'::jsonb),
    'unavailable', coalesce((
      select jsonb_agg(oi.name order by oi.id)
      from order_items oi
      left join menu_items mi on mi.id = oi.menu_item_id
      where oi.order_id = p_order_id
        and (mi.id is null or mi.available = false or mi.archived = true)
    ), '[]'::jsonb)
  );
end $$;

grant execute on function customer_reorder_payload(text, uuid) to anon, authenticated;

-- ── Fix visit counting in the CRM view ─────────────────────────────────────
-- 0018 counted every completed ORDER as a visit, so a table that ordered
-- three rounds during one sitting looked like three visits and inflated both
-- the visit count and the New/Regular/VIP segmentation built on top of it.
-- A visit is a SITTING: all orders sharing a table session collapse to one.
-- Takeaway has no session, so each takeaway order is its own visit.
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
  end as segment
from customers c
left join order_stats os on os.cafe_id = c.cafe_id and os.customer_id = c.id
left join favourite    f on f.cafe_id = c.cafe_id and f.customer_id = c.id
left join spend_rank   sr on sr.cafe_id = c.cafe_id and sr.customer_id = c.id
left join loyalty_accounts la on la.cafe_id = c.cafe_id and la.customer_id = c.id
left join v_loyalty_balance lb on lb.account_id = la.id;
