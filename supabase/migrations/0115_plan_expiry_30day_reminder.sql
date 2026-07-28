-- ============================================================================
-- 0115 — Add a second, earlier expiry reminder email sent ~30 days before
-- subscription_ends_at, alongside the existing ~7-day-out reminder from
-- 0114. Separate dedupe column so the two reminders are independent: a café
-- gets the 30-day heads-up once, then still gets the 7-day urgent reminder
-- once, each only resetting when the expiry date actually changes.
--
-- op_extend_subscription recreated verbatim from 0114, plus the one new
-- reset line — same care as every other high-traffic-function edit this
-- project makes.
-- ============================================================================

alter table cafes add column if not exists expiry_reminder_30d_sent_at timestamptz;

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
                  expiry_reminder_sent_at = null,
                  expiry_reminder_30d_sent_at = null
  where id = p_cafe_id;

  insert into platform_audit_logs (actor_id, action, target_type, target_id, previous_value, new_value)
  values (auth.uid(), 'cafe.subscription_extended', 'cafe', p_cafe_id, v_before,
          jsonb_build_object('subscription_ends_at', p_subscription_ends_at));
end $$;
