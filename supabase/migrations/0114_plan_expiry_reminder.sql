-- ============================================================================
-- 0114 — Track whether an expiry reminder email has already gone out for a
-- café's CURRENT subscription_ends_at, so the daily cron
-- (check-expiry/route.ts) can send exactly one reminder per expiry cycle
-- instead of re-sending every day the café stays within the reminder
-- window. Reset to null whenever the expiry date actually changes (this
-- RPC, or a Razorpay renewal webhook) so a renewed café gets a fresh
-- reminder next time it approaches expiry.
--
-- op_extend_subscription recreated verbatim from 0019, plus the one new
-- reset line — same care as every other high-traffic-function edit this
-- project makes.
-- ============================================================================

alter table cafes add column if not exists expiry_reminder_sent_at timestamptz;

create or replace function op_extend_subscription(
  p_cafe_id uuid, p_subscription_ends_at timestamptz, p_trial_ends_at timestamptz default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_before jsonb;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select jsonb_build_object('subscription_ends_at', subscription_ends_at, 'trial_ends_at', trial_ends_at)
    into v_before from cafes where id = p_cafe_id;
  if v_before is null then raise exception 'cafe not found'; end if;

  update cafes set subscription_ends_at = p_subscription_ends_at,
                  trial_ends_at = coalesce(p_trial_ends_at, trial_ends_at),
                  expiry_reminder_sent_at = null
  where id = p_cafe_id;

  insert into platform_audit_logs (actor_id, action, target_type, target_id, previous_value, new_value)
  values (auth.uid(), 'cafe.subscription_extended', 'cafe', p_cafe_id, v_before,
          jsonb_build_object('subscription_ends_at', p_subscription_ends_at));
end $$;
