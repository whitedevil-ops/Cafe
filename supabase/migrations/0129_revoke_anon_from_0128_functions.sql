-- ============================================================================
-- 0129 — Close the anon-execute gap on 0128's functions.
--
-- Same root cause 0015 already documented, and 0128 walked straight into it:
-- Supabase grants EXECUTE on public-schema functions directly to the `anon`
-- role via ALTER DEFAULT PRIVILEGES, so `revoke all ... from public` — which
-- is what 0128 did — never touches it. Revoking from PUBLIC only removes the
-- PUBLIC pseudo-role's grant, not a grant held by a real role.
--
-- Found by probing the live database with the anon key after 0128 was applied:
--
--   op_platform_overview   401  42501  permission denied     <- correct
--   op_list_users          400  P0001  not authorized        <- reached the body
--   op_user_detail         400  P0001  not authorized        <- reached the body
--   touch_user_activity    204                               <- executed
--
-- No data was exposed. op_list_users and op_user_detail both check
-- has_platform_permission('users.view') as their first statement and raised
-- before touching a row, and touch_user_activity writes only
-- `where id = auth.uid()`, which matches nothing when there is no session.
--
-- But "safe because of one if-statement inside the function" is not the
-- posture the rest of this schema holds, and an anonymous caller should not be
-- able to reach the body at all. This restores the intended layering.
-- ============================================================================

revoke execute on function op_list_users(text, integer) from anon;
revoke execute on function op_user_detail(uuid) from anon;
revoke execute on function touch_user_activity(text) from anon;

-- Belt and braces: authenticated is the only role that should hold these, and
-- an explicit grant here means the intent survives someone re-running an
-- earlier migration out of order.
grant execute on function op_list_users(text, integer)  to authenticated;
grant execute on function op_user_detail(uuid)          to authenticated;
grant execute on function touch_user_activity(text)     to authenticated;
