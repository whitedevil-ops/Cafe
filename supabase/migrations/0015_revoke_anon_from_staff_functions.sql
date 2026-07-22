-- ============================================================================
-- 0015 — Actually close the anon-execute gap (0014 didn't).
--
-- 0014 revoked from PUBLIC, but a live anonymous test after applying it still
-- reached staff_place_order's internal logic. Root cause: Supabase's default
-- project setup grants EXECUTE on functions in the public schema directly to
-- the `anon` role (via ALTER DEFAULT PRIVILEGES), independent of the PUBLIC
-- pseudo-role — revoking from PUBLIC never touches a grant made directly to
-- a real role. This revokes from `anon` explicitly, verified as the actual
-- fix before writing it here.
-- ============================================================================

revoke execute on function staff_place_order(uuid, jsonb, order_type, uuid, text, text) from anon;
revoke execute on function move_session(uuid, uuid) from anon;
revoke execute on function close_session(uuid) from anon;
