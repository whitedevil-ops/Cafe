-- ============================================================================
-- 0239 — CRITICAL: close a within-café privilege-escalation / account-takeover
-- path on cafe_members, confirmed live via independent adversarial re-check
-- during a production maturity audit (2026-09-13).
--
-- The vulnerability: cafe_members' only INSERT/UPDATE/DELETE policies, since
-- 0001, are:
--   "owner manage i" for insert with check (has_cafe_role(cafe_id, ['owner','manager']))
--   "owner manage u" for update using     (has_cafe_role(cafe_id, ['owner','manager']))  -- no WITH CHECK
--   "owner manage d" for delete using     (has_cafe_role(cafe_id, ['owner']))
-- has_cafe_role() only asks "does the CALLER have this role at this café" —
-- it never inspects which row is being targeted or what values are being
-- written. An UPDATE policy with no WITH CHECK reuses USING as the implicit
-- check on the new row, so both collapse to the same caller-only test. Since
-- 00-reset.sql's default privileges grant every table to `authenticated`, and
-- nothing ever revoked that for cafe_members (unlike orders/payments/
-- customers in 0050/0071, and cafes itself in 0163 — the identical bug class,
-- fixed there but missed here), any authenticated manager can call PostgREST
-- directly to:
--   UPDATE cafe_members SET role = 'owner' WHERE cafe_id = X AND user_id = auth.uid()
--     (self-promotion — passes USING, since the caller genuinely is a manager at X)
--   UPDATE cafe_members SET status = 'suspended' WHERE cafe_id = X AND user_id = <owner>
--     (lock out / demote the real owner — same USING check, target row is irrelevant to it)
-- bypassing the app UI and the properly-guarded create_staff_member RPC
-- entirely, with no audit trail (audit_logs is only written by the RPCs this
-- routes around).
--
-- Fix, matching the two-layer doctrine 0050/0071/0163 already established for
-- this exact bug class on other tables: revoke direct table privileges and
-- route every legitimate write through a SECURITY DEFINER RPC that actually
-- checks the target, not just the caller's own membership.
--
-- What's legitimately writable today, confirmed by reading every real
-- `.from('cafe_members')` call in the app (2026-09-13):
--   - ADD a member: already exclusively via create_staff_member (0142) — a
--     SECURITY DEFINER RPC that correctly requires owner/manager, and owner
--     specifically to grant the 'owner' role. Unaffected by this migration
--     (SECURITY DEFINER functions run as their owner, not the caller, so
--     revoking the caller's table grant doesn't touch them).
--   - REMOVE a member: app/dashboard/settings/settings-client.tsx's
--     removeMember() does a raw `.from('cafe_members').delete()`, relying on
--     "owner manage d" (owner-only) for authorization. This is the one real
--     direct-write path being closed here — replaced below by
--     remove_staff_member(), same owner-only bar, plus a new guard against
--     removing the last active owner (a café can't be left ownerless, mirroring
--     op_set_staff_status's identical guard for the platform-ops equivalent).
--   - CHANGE an existing member's role: no such UI/flow exists anywhere in the
--     app today (confirmed by grep) — nothing legitimate is closed by revoking
--     UPDATE entirely.
-- ============================================================================

revoke insert, update, delete on cafe_members from authenticated, anon;

drop policy if exists "owner manage i" on cafe_members;
drop policy if exists "owner manage u" on cafe_members;
drop policy if exists "owner manage d" on cafe_members;
-- "member read" / "platform admin read" (select) are untouched — read access
-- was never the vulnerability and both policies already check the caller
-- correctly rather than trusting a target row.

create or replace function remove_staff_member(p_cafe_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_role          member_role;
  v_active_owners integer;
begin
  if not has_cafe_role(p_cafe_id, array['owner']::member_role[]) then
    raise exception 'only an owner can remove staff';
  end if;

  select role into v_role from cafe_members where cafe_id = p_cafe_id and user_id = p_user_id;
  if v_role is null then
    raise exception 'this person is not a member of this café';
  end if;

  if v_role = 'owner' then
    select count(*) into v_active_owners from cafe_members
     where cafe_id = p_cafe_id and role = 'owner' and status = 'active';
    if v_active_owners <= 1 then
      raise exception 'cannot remove the only owner of this café — add another owner first';
    end if;
  end if;

  delete from cafe_members where cafe_id = p_cafe_id and user_id = p_user_id;
end $$;

revoke execute on function remove_staff_member(uuid, uuid) from public, anon;
grant execute on function remove_staff_member(uuid, uuid) to authenticated;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
begin
  if exists (
    select 1 from information_schema.role_table_grants
    where table_name = 'cafe_members' and grantee in ('authenticated', 'anon')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'cafe_members: authenticated/anon still hold a direct write grant';
  end if;
  if exists (
    select 1 from pg_policies
    where tablename = 'cafe_members' and policyname in ('owner manage i', 'owner manage u', 'owner manage d')
  ) then
    raise exception 'cafe_members: a dead escalation-era policy is still present';
  end if;
  if (select count(*) from pg_proc where proname = 'remove_staff_member') <> 1 then
    raise exception 'remove_staff_member: expected exactly one overload';
  end if;
end $$;
