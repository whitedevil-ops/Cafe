-- ============================================================================
-- 0014 — Tighten execute grants on staff-only functions.
--
-- Postgres grants EXECUTE to PUBLIC by default on any newly created function
-- unless explicitly revoked. staff_place_order/move_session/close_session were
-- each written with an internal is_cafe_member(auth.uid()) check that DOES
-- correctly reject anonymous callers (verified live: an anon call returned the
-- function's own "not authorized" error, not a database-level permission
-- error) — so there was no actual data exposure. But the grant itself was
-- looser than intended ("authenticated only"). Revoke the implicit PUBLIC
-- grant so the restriction is enforced at both layers, not just in the
-- function body.
-- ============================================================================

revoke execute on function staff_place_order(uuid, jsonb, order_type, uuid, text, text) from public;
revoke execute on function move_session(uuid, uuid) from public;
revoke execute on function close_session(uuid) from public;

grant execute on function staff_place_order(uuid, jsonb, order_type, uuid, text, text) to authenticated;
grant execute on function move_session(uuid, uuid) to authenticated;
grant execute on function close_session(uuid) to authenticated;
