-- ============================================================================
-- Full-audit finding, CRITICAL: the self-service Razorpay subscribe/renew
-- flow (POST /api/platform-billing/subscribe, used by both the normal
-- Upgrade button on /dashboard/billing AND the ExpiryRenewal screen a
-- suspended/expired café sees) is completely broken for every café. Root
-- cause: THIS SESSION'S OWN migration 0163_phase1_security_lockdown_part1.sql
-- revoked UPDATE on cafes from authenticated and replaced it with a specific
-- column-level grant list that omits razorpay_subscription_id and
-- billing_status -- a genuine gap in that otherwise-correct lockdown, not
-- anything wrong with 0163's core intent.
--
-- Live-verified: `update cafes set razorpay_subscription_id=..., billing_status=
-- 'created' where id=<real café>` as the real café owner -> "permission denied
-- for table cafes" (42501). The subscribe route creates a REAL Razorpay
-- subscription via the Razorpay API BEFORE this failing write, so every
-- attempt in production orphans a live Razorpay subscription object and
-- surfaces a raw Postgres error to the café owner instead of opening
-- checkout. Especially bad timing: once the check-expiry cron (separately
-- being fixed via CRON_SECRET) starts actually suspending expired cafés,
-- those cafés will have had ZERO working self-serve way back in.
--
-- NOT fixed by simply adding these two columns to 0163's grant list -- that
-- would make them writable to ANY value via ANY authenticated path for a
-- café the caller belongs to (a raw REST PATCH from devtools, not just this
-- route), reopening exactly the self-write risk 0163 was built to close.
-- The subscribe route's own values are safe (billing_status is hardcoded to
-- 'created', razorpay_subscription_id comes from Razorpay's own API
-- response -- never client-supplied) -- but a raw grant can't express "only
-- this narrow, safe transition", only an RPC can. So: a small, single-purpose
-- SECURITY DEFINER RPC instead, matching the pattern already used everywhere
-- else in this schema for a café-owner action that needs a write outside the
-- safe column allowlist.
-- ============================================================================

create or replace function record_subscription_started(p_cafe_id uuid, p_razorpay_subscription_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_cafe_role(p_cafe_id, array['owner']::member_role[]) then
    raise exception 'not authorized';
  end if;
  if p_razorpay_subscription_id is null or trim(p_razorpay_subscription_id) = '' then
    raise exception 'subscription id is required';
  end if;

  update cafes
  set razorpay_subscription_id = trim(p_razorpay_subscription_id),
      billing_status = 'created'
  where id = p_cafe_id;
end $$;

revoke all on function record_subscription_started(uuid, text) from public, anon;
grant execute on function record_subscription_started(uuid, text) to authenticated;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_proc where proname = 'record_subscription_started') <> 1 then
    raise exception 'record_subscription_started: expected exactly one overload';
  end if;
  -- Migrations run with no auth.uid(), so 'not authorized' is the expected,
  -- successful outcome here -- same pattern as every prior migration's
  -- self-check in this repo.
  begin
    perform record_subscription_started(gen_random_uuid(), 'sub_audit_probe');
    raise exception 'record_subscription_started should have raised for an unauthenticated caller';
  exception when others then
    if sqlerrm not like '%not authorized%' then raise; end if;
  end;
end $$;
