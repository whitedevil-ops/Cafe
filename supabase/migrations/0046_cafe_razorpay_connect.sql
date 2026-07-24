-- ============================================================================
-- 0046 — Per-café Razorpay connection. Each café uses ITS OWN Razorpay
-- account, so money settles to that café and KhaoPiyo needs no platform-level
-- Route approval.
--
-- SECRET HANDLING (the whole point of this migration's design):
--   • The café's Key ID is semi-public (it's sent to the browser at checkout),
--     so it lives on `cafes`.
--   • The Key Secret and Webhook Secret are TRUE secrets. They are encrypted
--     in the app (AES-256-GCM, lib/crypto) BEFORE they ever reach the
--     database, and stored in `cafe_payment_secrets` — a table with RLS
--     enabled and NO policies at all, so no client (not even the café's own
--     browser) can ever read them. Only server routes using the service role
--     can read the ciphertext, and only the app holding PAYMENTS_ENC_KEY can
--     decrypt it.
--   • The plaintext secret is never returned to any client, ever.
-- ============================================================================

alter table cafes add column if not exists razorpay_key_id       text;   -- rzp_live_… / rzp_test_… (semi-public)
alter table cafes add column if not exists razorpay_webhook_token text;   -- opaque token that routes this café's webhook

-- Encrypted secrets — never client-readable.
create table if not exists cafe_payment_secrets (
  cafe_id            uuid primary key references cafes(id) on delete cascade,
  provider           text not null default 'razorpay',
  key_secret_enc     text,   -- AES-256-GCM ciphertext (app-encrypted)
  webhook_secret_enc text,   -- AES-256-GCM ciphertext (app-encrypted)
  updated_at         timestamptz not null default now()
);
alter table cafe_payment_secrets enable row level security;
-- Intentionally ZERO policies: reachable only by the service role (server
-- routes) and the SECURITY DEFINER functions below. A café member's own
-- client can never SELECT its secret ciphertext.

-- ── Connect: store the (already-encrypted) secrets + mark connected ────────
-- The API route encrypts the secrets and passes ciphertext here. This runs as
-- an owner/manager and writes both the public key id and the private
-- ciphertext atomically, plus a stable webhook routing token.
create or replace function set_cafe_razorpay(
  p_cafe_id            uuid,
  p_key_id             text,
  p_key_secret_enc     text,
  p_webhook_secret_enc text
) returns text
language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  if not has_cafe_role(p_cafe_id, array['owner','manager']::member_role[]) then
    raise exception 'not authorized';
  end if;
  if p_key_id is null or trim(p_key_id) = '' then raise exception 'key id is required'; end if;

  insert into cafe_payment_secrets (cafe_id, provider, key_secret_enc, webhook_secret_enc, updated_at)
  values (p_cafe_id, 'razorpay', p_key_secret_enc, p_webhook_secret_enc, now())
  on conflict (cafe_id) do update
    set key_secret_enc = excluded.key_secret_enc,
        webhook_secret_enc = excluded.webhook_secret_enc,
        updated_at = now();

  select coalesce(razorpay_webhook_token, encode(gen_random_bytes(16), 'hex'))
    into v_token from cafes where id = p_cafe_id;

  update cafes
     set razorpay_key_id = trim(p_key_id),
         razorpay_status = 'connected',
         razorpay_webhook_token = v_token,
         online_payments_enabled = true
   where id = p_cafe_id;

  -- Audit the connection (not the secret) for the owner's trail.
  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (p_cafe_id, auth.uid(), 'payments.razorpay_connected', 'cafes', p_cafe_id,
          jsonb_build_object('key_id_last4', right(trim(p_key_id), 4)));

  return v_token;
end $$;
revoke execute on function set_cafe_razorpay(uuid, text, text, text) from public, anon;
grant execute on function set_cafe_razorpay(uuid, text, text, text) to authenticated;

-- ── Disconnect: wipe secrets + reset status ────────────────────────────────
create or replace function disconnect_cafe_razorpay(p_cafe_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_cafe_role(p_cafe_id, array['owner','manager']::member_role[]) then
    raise exception 'not authorized';
  end if;
  delete from cafe_payment_secrets where cafe_id = p_cafe_id;
  update cafes
     set razorpay_key_id = null, razorpay_status = 'not_connected', online_payments_enabled = false
   where id = p_cafe_id;
  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (p_cafe_id, auth.uid(), 'payments.razorpay_disconnected', 'cafes', p_cafe_id, '{}'::jsonb);
end $$;
revoke execute on function disconnect_cafe_razorpay(uuid) from public, anon;
grant execute on function disconnect_cafe_razorpay(uuid) to authenticated;
