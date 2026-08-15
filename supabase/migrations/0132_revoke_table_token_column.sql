-- ============================================================================
-- 0132 — Close the token leak. RUN THIS ONLY AFTER 0131 IS APPLIED **AND** THE
-- APP USING THE NEW RESOLVERS IS DEPLOYED.
--
-- ORDER MATTERS AND THE FAILURE IS CUSTOMER-VISIBLE:
--
--   0131 (resolvers)  ->  deploy app  ->  0132 (this revoke)
--
-- Run this before the app deploy and every QR order stops working, because the
-- old code filters `.eq('token', …)` and Postgres needs column SELECT
-- privilege for a WHERE reference. Run it after, and nothing changes for a
-- guest: the lookup already happens inside resolve_table_token(), which is
-- SECURITY DEFINER and reads the column as its owner.
--
-- WHAT THIS STOPS
--
-- Before: an anonymous request with the public anon key returned every café's
-- table tokens, and place_order accepts a token as its sole credential — so
-- order spam against every café on the platform needed one HTTP request and no
-- physical presence.
--
-- After: reading a token requires either possessing it (the sticker on the
-- table) or being a member of that café.
--
-- WHY authenticated IS REVOKED TOO
--
-- The `public read ... using (true)` policy from 0001 applies to every role,
-- not just anon. Revoking anon alone would still let any signed-up café owner
-- read every OTHER café's tokens. Members get their own tokens back through
-- list_cafe_tables_with_tokens(), which checks is_cafe_member.
--
-- NOT REVOKED: insert/update. Creating a table still writes a token normally
-- (INSERT needs no SELECT privilege on the column); only reading it back in
-- the same statement did, which is why tables-client.tsx no longer chains
-- .select() over the token column.
-- ============================================================================

revoke select (token) on cafe_tables from anon;
revoke select (token) on cafe_tables from authenticated;

comment on column cafe_tables.token is
  'Opaque QR token. SELECT is revoked from anon and authenticated (0132) — read it via resolve_table_token() as a guest, or list_cafe_tables_with_tokens() as a member. place_order resolves it internally as a definer.';
