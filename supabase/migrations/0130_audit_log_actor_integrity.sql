-- ============================================================================
-- 0130 — Stop the café audit trail being forgeable by its own staff.
--
-- The INSERT policy on audit_logs, set in 0011, checked the café and nothing
-- else:
--
--   create policy "member insert" on audit_logs for insert
--     with check (is_cafe_member(cafe_id));
--
-- `actor_id` was entirely unconstrained, and the browser supplies it directly
-- (app/dashboard/profile/profile-client.tsx:186 inserts with a client-chosen
-- actor_id). So any active member of a café — a cashier, a waiter — could
-- write history attributed to the owner, or invent events that never happened.
-- No migration between 0011 and here tightened it.
--
-- This is the café's own audit trail: the record an owner would consult after
-- a disputed refund or a cash discrepancy. A trail anyone on the floor can
-- write into is worse than no trail, because it looks authoritative.
--
-- Two constraints are added:
--
--   actor_id = auth.uid()   — you may only write as yourself
--   action like 'profile.%' — and only the event class the client actually
--                             emits, so a member cannot fabricate an
--                             'order.cancelled' or 'refund.issued' entry
--
-- SAFE FOR EXISTING CODE. Every other writer is an `insert into audit_logs`
-- inside a SECURITY DEFINER function (0012, 0016, 0017, 0019, 0025, 0026 and
-- others) — those run as the definer and bypass RLS entirely, so they are
-- unaffected and keep writing their own action names with their own actor.
-- The single browser writer already sets actor_id to the signed-in user.
--
-- Existing rows are not touched: nothing here can retroactively decide which
-- historical entries were genuine.
-- ============================================================================

drop policy if exists "member insert" on audit_logs;
create policy "member insert" on audit_logs for insert
  with check (
    is_cafe_member(cafe_id)
    and actor_id = auth.uid()
    and action like 'profile.%'
  );

comment on policy "member insert" on audit_logs is
  'Client-side inserts only: as yourself, and only profile.* events. Everything else must go through a SECURITY DEFINER function, which bypasses this policy by design.';
