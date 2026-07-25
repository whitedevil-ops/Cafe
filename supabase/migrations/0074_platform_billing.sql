-- ============================================================================
-- 0074 — Platform billing via Razorpay Subscriptions, closing the audit
-- finding that KhaoPiyo had zero mechanism to actually charge a café: every
-- plan change was a manual platform-admin action and subscription_ends_at
-- was a pure display field nothing ever enforced.
--
-- Deliberately separate from `cafes.status` (operational suspend/disable —
-- always a human platform-admin call, per 0019) with its own
-- `billing_status` (Razorpay-driven, automatic). A café can be billing_status
-- = 'past_due' while status stays 'active' during a grace period; only the
-- expiry cron (see app/api/platform-billing/check-expiry) flips `status`.
--
-- platform_plans.razorpay_plan_id is nullable on purpose: billing is
-- unavailable (not broken) for any plan without one configured, same
-- env-gated posture as the per-café Razorpay Connect flow.
-- ============================================================================

alter table platform_plans add column if not exists razorpay_plan_id text;

alter table cafes add column if not exists razorpay_subscription_id text;
alter table cafes add column if not exists billing_status text not null default 'none';
-- none (never subscribed) | created (checkout opened, not yet paid) |
-- active | past_due (payment failed, Razorpay retrying) | cancelled | expired

create table if not exists platform_billing_events (
  id                       uuid primary key default gen_random_uuid(),
  cafe_id                  uuid references cafes(id) on delete set null,
  razorpay_subscription_id text,
  event_type               text not null,
  payload                  jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now()
);
create index if not exists platform_billing_events_cafe_idx on platform_billing_events (cafe_id, created_at desc);
alter table platform_billing_events enable row level security;
-- Admin-only, and even then read-only — same "no café-facing policy at all"
-- pattern as operator_notes. Written exclusively by the webhook's service-role
-- client, which bypasses RLS entirely, so no insert policy is needed for anyone.
create policy "admin read" on platform_billing_events for select using (is_platform_admin());

-- ── Café-facing: read your own café's billing state ─────────────────────────
create or replace function platform_billing_state(p_cafe_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not has_cafe_role(p_cafe_id, array['owner','manager']::member_role[]) then
    raise exception 'only an owner or manager can view billing';
  end if;

  select jsonb_build_object(
    'plan', c.plan,
    'plan_name', pp.name,
    'price_monthly', pp.price_monthly,
    'billing_status', c.billing_status,
    'subscription_ends_at', c.subscription_ends_at,
    'status', c.status,
    'plans', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'key', key, 'name', name, 'price_monthly', price_monthly,
        'available', razorpay_plan_id is not null
      ) order by sort), '[]'::jsonb)
      from platform_plans
    )
  ) into v_result
  from cafes c
  left join platform_plans pp on pp.key = c.plan
  where c.id = p_cafe_id;

  return v_result;
end $$;

revoke execute on function platform_billing_state(uuid) from public, anon;
grant execute on function platform_billing_state(uuid) to authenticated;
