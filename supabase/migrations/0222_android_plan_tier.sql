-- ============================================================================
-- 0222 — Internal "Android" plan tier: a plan Ops can assign, that is never
-- shown to a café owner or the public, and that (once wired in app code —
-- separate, non-SQL work) can only actually be used from an Android device.
--
-- Two new platform_plans columns:
--   - internal_only: true means "never surface to a café owner or the
--     public," independent of `active` (which already means "Ops can assign
--     this" — op_change_plan, 0188, requires `active` to accept a plan key).
--     The new row needs BOTH active=true and internal_only=true.
--   - android_only: a plain plan PROPERTY, like max_staff/razorpay_plan_id
--     already are — deliberately NOT a features-jsonb key. hasFeature()
--     (lib/entitlements.ts) fails OPEN on RPC error by design (a billing
--     lookup hiccup must never take a kitchen offline); resolving device
--     restriction through that same path would mean a transient error makes
--     every café on every plan appear Android-restricted at once. A column
--     read alongside the plan row app/dashboard/layout.tsx already fetches
--     has no such failure mode.
--
-- Two real pre-existing leaks found while building this (not new bugs
-- introduced by adding a row — they'd affect ANY unfiltered platform_plans
-- row, e.g. if `active` were ever true on a plan not meant for self-serve
-- display) are closed here too:
--   1. platform_billing_state() (0090) builds its `plans` array with no
--      WHERE clause at all — every row, including this one, would render as
--      a plan card on the café owner's own /dashboard/billing page.
--   2. The "authenticated read" RLS policy on platform_plans (0019) is
--      `using (true)` — any logged-in user can read every plan row directly
--      over PostgREST, independent of what any RPC or app query filters.
--
-- Feature set: copied verbatim from the CURRENT live 'pro' (Growth) plan's
-- features jsonb, traced through every migration that has touched it
-- (0019 seed -> 0073 -> 0083 -> 0091 -> 0111 -> 0156/0158 -> 0204 -> 0219)
-- — including its two known-dead keys (kds, multi_staff — nothing reads
-- them, see the 2026-09 dead-code audit) and referral:false (the referral
-- feature's frontend was removed platform-wide; its backend is still live
-- but unreachable for every plan, not something this migration changes).
-- Byte-consistent with what Growth actually grants today, not an edited
-- "clean" version — Ops can change any of this per-café via the existing
-- feature-override UI regardless.
--
-- Pricing/limits are placeholders (matching Starter's numbers) by explicit
-- decision — this is a plain database row, changeable via Ops at any time
-- with zero code impact either way.
-- ============================================================================

alter table platform_plans add column if not exists internal_only boolean not null default false;
alter table platform_plans add column if not exists android_only  boolean not null default false;

insert into platform_plans (
  key, name, price_monthly, price_yearly, renewal_price_yearly,
  features, sort, active, max_owned_cafes, max_staff, razorpay_plan_id,
  internal_only, android_only
) values (
  'android', 'Android', 999, 10000, 5000,
  '{
    "qr_ordering": true, "kds": true, "crm": true, "inventory": false,
    "reservations": true, "advanced_analytics": true, "sms_bills": true,
    "multi_staff": true, "advanced_reports": false, "loyalty": true,
    "coupons": true, "online_payments": true, "expenses": true,
    "wallet": true, "referral": false, "whatsapp_bills": true, "spin": true
  }'::jsonb,
  100, true, 1, 3, null,
  true, true
)
on conflict (key) do nothing;

-- ── close leak #1: platform_billing_state must never surface an
-- internal-only plan to a café owner ────────────────────────────────────────
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
    'price_yearly', pp.price_yearly,
    'renewal_price_yearly', pp.renewal_price_yearly,
    'billing_status', c.billing_status,
    'subscription_ends_at', c.subscription_ends_at,
    'status', c.status,
    'plans', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'key', key, 'name', name,
        'price_monthly', price_monthly,
        'price_yearly', price_yearly,
        'renewal_price_yearly', renewal_price_yearly,
        'available', razorpay_plan_id is not null
      ) order by sort), '[]'::jsonb)
      from platform_plans
      where active and not internal_only
    )
  ) into v_result
  from cafes c
  left join platform_plans pp on pp.key = c.plan
  where c.id = p_cafe_id;

  return v_result;
end $$;

revoke execute on function platform_billing_state(uuid) from public, anon;
grant execute on function platform_billing_state(uuid) to authenticated;

-- ── close leak #2: narrow direct table read access ──────────────────────────
-- "admin all" (is_platform_admin()) is untouched and OR's with this policy,
-- so Ops keeps full visibility regardless of this change.
drop policy if exists "authenticated read" on platform_plans;
create policy "authenticated read" on platform_plans
  for select to authenticated
  using (active and not internal_only);

-- ── self-check ─────────────────────────────────────────────────────────────
do $$
declare v_row record;
begin
  select * into v_row from platform_plans where key = 'android';
  if v_row.id is null then raise exception 'android plan row was not inserted'; end if;
  if not v_row.active then raise exception 'android plan must be active for op_change_plan to accept it'; end if;
  if not v_row.internal_only then raise exception 'android plan must be internal_only'; end if;
  if not v_row.android_only then raise exception 'android plan must be android_only'; end if;
  if v_row.razorpay_plan_id is not null then raise exception 'android plan must not have a razorpay_plan_id'; end if;

  if not exists (
    select 1 from pg_policies
    where tablename = 'platform_plans' and policyname = 'authenticated read'
      and qual = 'active AND (NOT internal_only)'
  ) then
    raise notice 'authenticated read policy qual text did not match the expected form exactly (cosmetic — Postgres may reformat the stored expression); verify manually with \d+ platform_plans if this notice appears';
  end if;

  -- Every existing plan must be completely unaffected by this migration.
  if exists (select 1 from platform_plans where key in ('trial','starter','pro','business') and (internal_only or android_only)) then
    raise exception 'an existing plan was incorrectly flagged internal_only/android_only';
  end if;
end $$;
