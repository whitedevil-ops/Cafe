-- ============================================================================
-- 0219 — Delete the Customer Feedback feature completely, backend and all.
--
-- Its customer-facing intake point (the star-rating gate on the receipt
-- page, components/receipt/feedback-form.tsx) was already deleted in 0161,
-- replaced by a plain owner-configured link (bill_link_url/BillLinkCta) —
-- deliberately, to drop the "4-5 stars → Google review" gating pattern.
-- Since then nothing in the app has called submit_feedback at all: the
-- table, its two RPCs, the owner-facing /dashboard/feedback page, its plan
-- entitlement, and its role-access screen key have all been dead weight —
-- reachable in theory, unreachable in practice. This finishes the job 0161
-- started: remove what it left behind rather than let orphaned plumbing
-- keep showing up in the nav, the plan-features grid, and Role access for a
-- feature nobody can actually trigger anymore.
--
-- Removes, in dependency order:
--   - submit_feedback / feedback_summary (RPCs)
--   - feedback (table — cascades its own index + RLS policies)
--   - 'feedback' from all_screen_keys() and default_role_screens() (owner,
--     manager) — restated in full from the latest live bodies (0135), byte-
--     identical except for the one removed key
--   - 'feedback' from every platform_plans.features JSONB row
--   - any cafe_feature_overrides rows keyed 'feedback', and any
--     cafe_role_screens (0096) rows keyed 'feedback' — a café-level
--     override for a feature/screen that no longer exists is not a setting
--     worth preserving
--
-- Deliberately NOT touched: cafes.google_review_url and cafes.bill_link_url/
-- bill_link_enabled — a different, still-live feature (0109, 0161), only
-- related by both once being "a link/prompt shown on the bill." Historical
-- rows in `feedback` (any real ratings collected before 0161) are deleted
-- with the table — there is no dashboard left to view them from once this
-- runs, so there is nothing to preserve them for.
-- ============================================================================

drop function if exists submit_feedback(uuid, integer, text);
drop function if exists feedback_summary(uuid, timestamptz, timestamptz);
drop table if exists feedback;

-- ── screen-access key lists, restated in full from 0135 minus 'feedback' ────
create or replace function all_screen_keys()
returns text[] language sql immutable as $$
  select array['dashboard','pos','tables','bills','shift','kitchen','menu','customers',
               'inventory','purchases','recipes','coupons','loyalty','wallet','reports','expenses',
               'reservations','analytics',
               'profile','qr_codes','billing','settings']
$$;

create or replace function default_role_screens(p_role member_role)
returns text[] language sql immutable as $$
  select case p_role
    when 'owner'      then array['dashboard','pos','tables','bills','shift','kitchen','menu','customers','inventory','purchases','recipes','coupons','loyalty','wallet','reports','expenses','reservations','analytics','profile','qr_codes','billing','settings']
    when 'manager'    then array['dashboard','pos','tables','bills','shift','kitchen','menu','customers','inventory','purchases','recipes','coupons','loyalty','wallet','reports','expenses','reservations','analytics','profile','qr_codes','settings']
    when 'cashier'    then array['dashboard','pos','tables','bills','shift','kitchen']
    when 'waiter'     then array['pos','tables','kitchen']
    when 'kitchen'    then array['kitchen']
    when 'accountant' then array['dashboard','bills','reports','expenses','billing']
    else array[]::text[]
  end
$$;

-- ── plan entitlement + per-café screen-access override cleanup ─────────────
update platform_plans set features = features - 'feedback' where features ? 'feedback';
delete from cafe_feature_overrides where feature_key = 'feedback';
-- cafe_role_screens (0096) — any café that ever toggled the Feedback screen
-- on/off for a specific role in Settings -> Role access left a row here.
delete from cafe_role_screens where screen_key = 'feedback';

-- ── self-check ─────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'feedback') then
    raise exception 'feedback table was not dropped';
  end if;
  if exists (select 1 from pg_proc where proname in ('submit_feedback', 'feedback_summary')) then
    raise exception 'submit_feedback/feedback_summary were not dropped';
  end if;
  if 'feedback' = any(all_screen_keys()) then
    raise exception 'all_screen_keys() still lists feedback';
  end if;
  if 'feedback' = any(default_role_screens('owner'::member_role)) then
    raise exception 'default_role_screens(owner) still lists feedback';
  end if;
  if exists (select 1 from platform_plans where features ? 'feedback') then
    raise exception 'a platform_plans row still has a feedback feature key';
  end if;
  if exists (select 1 from cafe_feature_overrides where feature_key = 'feedback') then
    raise exception 'a cafe still has a feedback feature override';
  end if;
  if exists (select 1 from cafe_role_screens where screen_key = 'feedback') then
    raise exception 'a cafe still has a feedback role-screen override';
  end if;
  -- Reservations/analytics — the two keys 0135 itself added — must still be
  -- present; this migration's array restatement must not have dropped them
  -- by accident along with 'feedback'.
  if not ('reservations' = any(all_screen_keys()) and 'analytics' = any(all_screen_keys())) then
    raise exception 'all_screen_keys() lost reservations/analytics during this restatement';
  end if;
end $$;
