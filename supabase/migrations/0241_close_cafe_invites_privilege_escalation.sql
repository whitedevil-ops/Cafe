-- ============================================================================
-- 0241 — CRITICAL: cafe_invites has the exact same privilege-escalation bug
-- as cafe_members (0239, fixed 2026-09-13) — a different table, never fixed.
-- Found by a final production-readiness pass, confirmed by two independent
-- adversarial re-checks.
--
-- The vulnerability: cafe_invites' only INSERT policy ("admin insert", 0007)
-- is `with check (has_cafe_role(cafe_id, ['owner','manager']))` — it
-- authorizes based on the CALLER's own role at cafe_id, but never restricts
-- the VALUE of the `role` column being written into the new row. Table-level
-- INSERT was never revoked from `authenticated` (00-reset.sql's default
-- privileges), so a manager can send a direct PostgREST insert —
--   POST /rest/v1/cafe_invites  { cafe_id: X, email: 'someone@example.com', role: 'owner' }
-- — which passes RLS cleanly. claim_my_invites() (0007, unchanged, still
-- live, still granted to authenticated) then converts that invite into a
-- real cafe_members row with role='owner' the moment that email's account
-- calls it (which happens automatically on any dashboard/onboarding load
-- for a user with zero existing memberships, per lib/cafe.ts's
-- getMemberships()) — with zero re-validation of who granted that role.
-- create_staff_invite, the one function that DID enforce "only an owner can
-- grant owner" (added in 0142 BUG 4 for this exact bug class), was dropped
-- as dead code in 0220_drop_dead_functions.sql — but the raw table INSERT
-- policy and claim_my_invites() were left completely intact, so removing
-- the one RPC-layer check left the underlying table wide open.
--
-- Fix: this creation path is genuinely retired, not just narrowable. Grepping
-- every current `.from('cafe_invites')` call in the app (2026-09-13) shows
-- only a SELECT (Settings, listing old pending invites) and a DELETE
-- (removing a stale one) — nothing in the current UI creates a new invite
-- (0197's own header already notes production holds zero rows in this
-- table). So unlike cafe_members, there is no legitimate creation flow to
-- preserve or re-route through an RPC — the correct fix is simply to close
-- the INSERT path entirely. "member read" and "admin delete" are untouched:
-- viewing/removing an existing invite is harmless regardless of its role
-- value, since deleting only removes an option, never grants one.
-- ============================================================================

revoke insert on cafe_invites from authenticated, anon;
drop policy if exists "admin insert" on cafe_invites;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
begin
  if exists (
    select 1 from information_schema.role_table_grants
    where table_name = 'cafe_invites' and grantee in ('authenticated', 'anon') and privilege_type = 'INSERT'
  ) then
    raise exception 'cafe_invites: authenticated/anon still hold a direct INSERT grant';
  end if;
  if exists (select 1 from pg_policies where tablename = 'cafe_invites' and policyname = 'admin insert') then
    raise exception 'cafe_invites: the dead escalation-era insert policy is still present';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'cafe_invites' and policyname = 'member read') then
    raise exception 'cafe_invites: "member read" (the legitimate Settings list view) was unexpectedly removed';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'cafe_invites' and policyname = 'admin delete') then
    raise exception 'cafe_invites: "admin delete" (the legitimate remove-stale-invite path) was unexpectedly removed';
  end if;
end $$;
